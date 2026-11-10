/*
 * zcode provider adapter.
 *
 * Raw zcode provider. All completion/marker concerns live in
 * `withMarkerCompletion`, so this provider only parses the flat JSONL stream
 * emitted by `assets/zcodeWrapper.mjs` (which speaks the ZCode Protocol to
 * `zcode app-server`) and builds the wrapper command.
 */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { packageRoot } from "../runtime.js";
import { sandcastleSessionStorage } from "./session-storage.js";

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

export function zcodeProvider(
	model: string,
	options?: {
		effort?: string;
		/** Marker scope for the session store (issue phases and planner scopes). */
		scope?: string;
	},
): AgentProvider {
	const wrapperPath = `${packageRoot}/assets/zcodeWrapper.mjs`.replaceAll("\\", "/");
	const modelFlag = model.trim() !== "" ? ` --model ${JSON.stringify(model.trim())}` : "";
	const effortFlag =
		options?.effort !== undefined && options.effort !== ""
			? ` --reasoning-effort ${options.effort}`
			: "";

	return {
		captureSessions: false,
		// zcode brings its own OAuth credentials; no env injection needed.
		env: {},
		name: "zcode",
		...(options?.scope !== undefined
			? { sessionStorage: sandcastleSessionStorage(options.scope, "zcode") }
			: {}),

		buildPrintCommand({ dangerouslySkipPermissions, prompt, resumeSession }): PrintCommand {
			/*
			 * @ai-hero's run() always passes dangerouslySkipPermissions: true; the
			 * yolo mode maps to it, while the fallback keeps zcode's default build mode.
			 */
			const modeFlag = dangerouslySkipPermissions ? " --mode yolo" : "";
			// The wrapper maps --resume-session to the app-server's session/resume.
			const resumeFlag =
				resumeSession !== undefined ? ` --resume-session ${resumeSession}` : "";
			return {
				command: `node ${wrapperPath}${modeFlag}${modelFlag}${effortFlag}${resumeFlag}`,
				stdin: prompt,
			};
		},

		parseStreamLine(line: string): Array<StreamEvent> {
			let parsed: {
				detail?: unknown;
				name?: unknown;
				result?: unknown;
				sessionId?: unknown;
				state?: unknown;
				text?: unknown;
				type?: unknown;
				usage?: Record<string, unknown>;
			};
			try {
				parsed = JSON.parse(line);
			} catch {
				return [];
			}

			if (parsed.type === "text" && typeof parsed.text === "string" && parsed.text !== "") {
				return [{ type: "text", text: parsed.text }];
			}

			if (
				parsed.type === "result" &&
				typeof parsed.result === "string" &&
				parsed.result !== ""
			) {
				return [{ type: "result", result: parsed.result }];
			}

			if (
				parsed.type === "usage" &&
				parsed.usage !== undefined &&
				typeof parsed.usage === "object"
			) {
				const { usage } = parsed;
				return [
					{
						type: "usage",
						usage: {
							cacheCreationInputTokens: Number(usage.cacheCreationInputTokens ?? 0),
							cacheReadInputTokens: Number(usage.cacheReadInputTokens ?? 0),
							inputTokens: Number(usage.inputTokens ?? 0),
							outputTokens: Number(usage.outputTokens ?? 0),
						},
					},
				];
			}

			/*
			 * Tool activity surfaces as a typed `tool_call` event — upstream
			 * renders `name + args` into the file log and its toolCall stream
			 * event, matching dirac's card-level visibility. Note events
			 * (permission auto-answers, user-input cancels) reach the raw `.log`
			 * through the upstream stdout tee and need no typed mapping.
			 */
			if (parsed.type === "tool" && typeof parsed.name === "string") {
				return [
					{
						type: "tool_call",
						args: typeof parsed.detail === "string" ? parsed.detail : "",
						name: parsed.name,
					},
				];
			}

			/*
			 * {type:"session_id"} is the wrapper announcing the session id — the
			 * typed event upstream records on the iteration so the retry loop can
			 * resume it. {type:"note"}, {type:"keepalive"} and unknown shapes
			 * carry nothing the runner consumes (note text reaches the raw .log
			 * through upstream's stdout tee); they still count as output upstream
			 * (idle timeout), which is why the wrapper emits keep-alive events —
			 * re-armed by stdout-producing protocol activity only, so long
			 * pure-thinking stretches keep the heartbeat alive instead of
			 * starving upstream's 600s idle watchdog (AgentIdleTimeoutError).
			 */
			if (parsed.type === "session_id" && typeof parsed.sessionId === "string") {
				return [{ type: "session_id", sessionId: parsed.sessionId }];
			}

			return [];
		},
	};
}

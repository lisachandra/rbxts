/* zcode provider adapter: the wrapper command and its flat JSONL stream. */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { toShellCommand } from "../child-process.js";
import { packageRoot } from "../runtime.js";
import { sandcastleSessionStorage } from "./session-storage.js";

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

/**
 * - The raw zcode provider.
 * - @param model - Model id passed to the wrapper as `--model`; whitespace-only means "let zcode
 *   choose".
 * - @param options.effort - Reasoning effort, forwarded as `--reasoning-effort` when set and
 *   non-empty. zcode registers its own level names (`low|high|max` for glm/deepseek); callers are
 *   expected to have mapped the workflow level through `resolveBackendEffort`, which turns `xhigh`
 *   into `high` here.
 * - @param options.scope - Marker scope for the session store; supplying it is what enables resume.
 * - @returns A provider that speaks the zcode wrapper's flat JSONL stream.
 * - @remarks The command runs `assets/zcodeWrapper.mjs` under `node`, because the wrapper speaks the
 *   ZCode Protocol to `zcode app-server` and re-emits it as JSONL. `--mode yolo` is passed only
 *   when `dangerouslySkipPermissions` is set; otherwise zcode's default build mode applies.
 *   `--resume-session` maps to the app-server's `session/resume`.
 *
 *   Every argument goes through `toShellCommand`, so neither the model nor a captured session id can
 *   terminate its own argument or be read as another flag. That matters more here than for the other
 *   adapters: the session id comes from a previous run's stream.
 *
 *   `env` is empty on purpose — zcode reads its own OAuth credentials, so there is nothing to inject.
 */
export function zcodeProvider(
	model: string,
	options?: {
		effort?: string;
		/** Marker scope for the session store (issue phases and planner scopes). */
		scope?: string;
	},
): AgentProvider {
	const wrapperPath = `${packageRoot}/assets/zcodeWrapper.mjs`.replaceAll("\\", "/");

	return {
		captureSessions: false,
		// zcode brings its own OAuth credentials; no env injection needed.
		env: {},
		name: "zcode",
		...(options?.scope !== undefined
			? { sessionStorage: sandcastleSessionStorage(options.scope, "zcode") }
			: {}),

		buildPrintCommand({ dangerouslySkipPermissions, prompt, resumeSession }): PrintCommand {
			const args: Array<string> = [wrapperPath];

			/*
			 * @ai-hero's run() always passes dangerouslySkipPermissions: true; the
			 * yolo mode maps to it, while the fallback keeps zcode's default build mode.
			 */
			if (dangerouslySkipPermissions) {
				args.push("--mode", "yolo");
			}

			if (model.trim() !== "") {
				args.push("--model", model.trim());
			}

			if (options?.effort !== undefined && options.effort !== "") {
				args.push("--reasoning-effort", options.effort);
			}

			// The wrapper maps --resume-session to the app-server's session/resume.
			if (resumeSession !== undefined) {
				args.push("--resume-session", resumeSession);
			}

			/*
			 * `toShellCommand` quotes every argument, so neither the model nor a captured session id
			 * can end its own argument or be read as another flag.
			 */
			return {
				command: toShellCommand({ args, file: "node" }),
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

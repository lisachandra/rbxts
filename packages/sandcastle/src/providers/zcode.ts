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

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

export function zcodeProvider(
	model: string,
	options?: {
		effort?: string;
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

		buildPrintCommand({ dangerouslySkipPermissions, prompt }): PrintCommand {
			/*
			 * @ai-hero's run() always passes dangerouslySkipPermissions: true; the
			 * yolo mode maps to it, while the fallback keeps zcode's default build mode.
			 */
			const modeFlag = dangerouslySkipPermissions ? " --mode yolo" : "";
			return {
				command: `node ${wrapperPath}${modeFlag}${modelFlag}${effortFlag}`,
				stdin: prompt,
			};
		},

		parseStreamLine(line: string): Array<StreamEvent> {
			let parsed: {
				name?: unknown;
				result?: unknown;
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
			 * {type:"session_id"}, {type:"tool"}, {type:"keepalive"} and unknown
			 * shapes carry nothing the runner consumes; they still count as output
			 * upstream (idle timeout), which is why the wrapper emits keep-alive events.
			 */
			return [];
		},
	};
}

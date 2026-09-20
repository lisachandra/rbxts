/*
 * Dirac provider adapter.
 *
 * Raw dirac provider. All completion/marker concerns live in
 * `withMarkerCompletion`, so this provider only parses dirac's stream events
 * and builds the dirac CLI command via `assets/dirac-wrapper.sh`.
 */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { packageRoot } from "../runtime.js";

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

export function diracProvider(
	model: string,
	options?: {
		effort?: string;
		env?: Record<string, string>;
	},
): AgentProvider {
	// oxlint-disable-next-line typescript/prefer-optional-chain -- Access with index string for env
	let provider = (options?.env ?? {}).OPENAI_API_BASE ?? "";
	provider = provider ? `-p ${provider}` : "";

	return {
		captureSessions: false,
		env: options?.env ?? {},
		name: "dirac",

		buildPrintCommand({ dangerouslySkipPermissions, prompt }): PrintCommand {
			const yoloFlag = dangerouslySkipPermissions ? " -y" : "";
			const effortFlag =
				options?.effort !== undefined && options.effort !== ""
					? ` --reasoning-effort ${options.effort}`
					: "";
			const wrapperPath = `${packageRoot}/assets/dirac-wrapper.sh`.replaceAll("\\", "/");
			return {
				/*
				 * The wrapper captures stdin to a temp file and passes it as a CLI
				 * argument with stdin from /dev/null, avoiding Ink's raw-mode error.
				 */
				command: `bash ${wrapperPath} --json${yoloFlag}${effortFlag} --api-error-max-retries 0 ${provider} -m ${JSON.stringify(model)}`,
				stdin: prompt,
			};
		},

		parseStreamLine(line: string): Array<StreamEvent> {
			try {
				const parsed = JSON.parse(line);
				const events: Array<StreamEvent> = [];

				if (
					parsed.content?.type === "markdown" &&
					parsed.content.role !== "user" &&
					parsed.content.isReasoning !== true
				) {
					const rawContent = parsed.content.content;
					const newText = typeof rawContent === "string" ? rawContent : "";
					/*
					 * Surface assistant markdown even when `isReasoning` is absent (some backends
					 * omit the field), but drop known noise so the terminal/log stay readable.
					 */
					const isNoise =
						newText.startsWith("Retrying API request...") ||
						newText.startsWith("[workspace stdout") ||
						newText.startsWith('{"rules"');
					if (newText !== "" && !isNoise) {
						events.push({ type: "text", text: newText });
					}
				}

				/*
				 * Card bodies are surfaced as result events so phases with
				 * little assistant text still produce non-empty stdout.
				 */
				if (
					parsed.content?.type === "card" &&
					parsed.content.card?.body !== undefined &&
					parsed.content.card.body !== ""
				) {
					events.push({ type: "result", result: parsed.content.card.body });
				}

				if (
					parsed.content?.type === "api_status" &&
					parsed.content.status !== undefined &&
					parsed.content.status !== ""
				) {
					const s = parsed.content.status;
					events.push({
						type: "usage",
						usage: {
							cacheCreationInputTokens: s.cacheWrites ?? 0,
							cacheReadInputTokens: s.cacheReads ?? 0,
							inputTokens: s.tokensIn ?? 0,
							outputTokens: s.tokensOut ?? 0,
						},
					});
				}

				return events;
			} catch {
				return [];
			}
		},
	};
}

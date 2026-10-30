/*
 * Dirac provider adapter.
 *
 * Raw dirac provider. All completion/marker concerns live in
 * `withMarkerCompletion`, so this provider only parses dirac's stream events
 * and builds the dirac CLI command via `assets/dirac-wrapper.sh`.
 */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { packageRoot } from "../runtime.js";
import { sandcastleSessionStorage } from "./session-storage.js";

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

/**
 * Marker scope a provider instance's sessions are stored under. Providers are constructed per phase
 * with the marker path (`<issue>.<phase>.completed`); deriving the scope from it keeps the store
 * aligned with `runMarkerPhase`.
 */
export function scopeForMarkerPath(markerPath: string): string {
	return markerPath
		.replaceAll("\\", "/")
		.split("/")
		.at(-1)!
		.replace(/\.completed$/, "");
}

export function diracProvider(
	model: string,
	options?: {
		effort?: string;
		env?: Record<string, string>;
		/** Marker scope for the session store (issue phases and planner scopes). */
		scope?: string;
	},
): AgentProvider {
	// oxlint-disable-next-line typescript/prefer-optional-chain -- Access with index string for env
	let provider = (options?.env ?? {}).OPENAI_API_BASE ?? "";
	provider = provider ? `-p ${provider}` : "";

	return {
		captureSessions: false,
		env: options?.env ?? {},
		name: "dirac",
		...(options?.scope !== undefined
			? { sessionStorage: sandcastleSessionStorage(options.scope, "dirac") }
			: {}),

		buildPrintCommand({ dangerouslySkipPermissions, prompt, resumeSession }): PrintCommand {
			const yoloFlag = dangerouslySkipPermissions ? " -y" : "";
			const effortFlag =
				options?.effort !== undefined && options.effort !== ""
					? ` --reasoning-effort ${options.effort}`
					: "";
			// dirac resumes a task by id with `-T <taskId>` (see dirac's cli/src/index.ts).
			const resumeFlag = resumeSession !== undefined ? ` -T ${resumeSession}` : "";
			const wrapperPath = `${packageRoot}/assets/dirac-wrapper.sh`.replaceAll("\\", "/");
			return {
				/*
				 * The wrapper captures stdin to a temp file and passes it as a CLI
				 * argument with stdin from /dev/null, avoiding Ink's raw-mode error.
				 */
				command: `bash ${wrapperPath} --json${yoloFlag}${effortFlag}${resumeFlag} --api-error-max-retries 0 ${provider} -m ${JSON.stringify(model)}`,
				stdin: prompt,
			};
		},

		parseStreamLine(line: string): Array<StreamEvent> {
			try {
				const parsed = JSON.parse(line);
				const events: Array<StreamEvent> = [];

				/*
				 * The first stream line announces the task id (`{"type":"task_started",
				 * "taskId"}`); surfacing it as a session_id event is what lets upstream
				 * record it on the iteration and the retry loop resume it later.
				 */
				if (parsed.type === "task_started" && typeof parsed.taskId === "string") {
					events.push({ type: "session_id", sessionId: parsed.taskId });
				}

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

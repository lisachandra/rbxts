/* Dirac provider adapter: dirac's CLI command and JSON stream. */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { toShellCommand } from "../child-process.js";
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

/**
 * - The raw dirac provider.
 * - @param model - Model id passed to the dirac CLI as `-m`.
 * - @param options.effort - Reasoning effort, forwarded as `--reasoning-effort` when set and
 *   non-empty. Dirac supports `max` natively, so nothing is clamped here.
 * - @param options.env - Environment for the run. `OPENAI_API_BASE`, when present and non-empty, is
 *   also passed as the CLI's `-p` provider flag.
 * - @param options.scope - Marker scope for the session store; supplying it is what enables resume,
 *   because upstream gates `resumeSession` on the provider shipping `sessionStorage`.
 * - @returns A provider that speaks dirac's JSON stream.
 * - @remarks All completion and marker concerns live in `withMarkerCompletion`, so this provider only
 *   builds the command and parses events. `--api-error-max-retries 0` is deliberate: retries belong
 *   to `runPhaseWithRetry`, which can resume the captured session, and letting the CLI retry inside
 *   one attempt hides the failure from the retry policy. A resumed run passes the task id via
 *   `-T`.
 *
 *   The first stream line is `{"type":"task_started","taskId"}`; it is surfaced as a `session_id`
 *   event so upstream records the id and a later attempt can resume it. Reasoning and known noise
 *   (retry notices, workspace stdout dumps, rules JSON) are dropped from the text stream.
 */
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
	const providerBase = (options?.env ?? {}).OPENAI_API_BASE ?? "";

	return {
		captureSessions: false,
		env: options?.env ?? {},
		name: "dirac",
		...(options?.scope !== undefined
			? { sessionStorage: sandcastleSessionStorage(options.scope, "dirac") }
			: {}),

		buildPrintCommand({ dangerouslySkipPermissions, prompt, resumeSession }): PrintCommand {
			const wrapperPath = `${packageRoot}/assets/dirac-wrapper.sh`.replaceAll("\\", "/");
			const args: Array<string> = [wrapperPath, "--json"];

			if (dangerouslySkipPermissions) {
				args.push("-y");
			}

			if (options?.effort !== undefined && options.effort !== "") {
				args.push("--reasoning-effort", options.effort);
			}

			// dirac resumes a task by id with `-T <taskId>` (see dirac's cli/src/index.ts).
			if (resumeSession !== undefined) {
				args.push("-T", resumeSession);
			}

			args.push("--api-error-max-retries", "0");

			if (providerBase !== "") {
				args.push("-p", providerBase);
			}

			args.push("-m", model);

			return {
				/*
				 * The wrapper captures stdin to a temp file and passes it as a CLI
				 * argument with stdin from /dev/null, avoiding Ink's raw-mode error.
				 *
				 * Quoting is not this file's job: `toShellCommand` quotes every argument, so neither
				 * the model nor a captured session id can end its own argument.
				 */
				command: toShellCommand({ args, file: "bash" }),
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

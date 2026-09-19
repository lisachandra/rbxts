/*
 * Agent providers (dirac plus the @ai-hero/sandcastle backends) and the
 * prompt-context helpers that build skills lists and fetch issue metadata.
 */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { config, io, packageRoot, repoRoot } from "./runtime.js";
import { withMarkerCompletion } from "./providers/marker.js";
import type { AgentBackend, SandcastleEffort } from "./types.js";

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

export function resolveBackendEffort(effort: string, backend?: AgentBackend): SandcastleEffort {
	if (effort !== "max") {
		return effort as SandcastleEffort;
	}

	return backend === "dirac" || backend === "claude-code" ? "max" : "xhigh";
}

/**
 * Raw dirac provider. All completion/marker concerns live in `withMarkerCompletion`, so this
 * provider only parses dirac's stream events.
 */
export function diracAgent(
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
					? ` --reasoning-effort ${resolveBackendEffort(options.effort, "dirac")}`
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

export function createAgent(
	backend: AgentBackend,
	model: string,
	effort: string,
	markerPath: string,
): AgentProvider {
	const resolvedEffort = resolveBackendEffort(effort, backend);
	let inner: AgentProvider;
	switch (backend) {
		case "claude-code": {
			inner = io.claudeCode(model, {
				captureSessions: false,
				effort: effort as "low" | "max" | "high" | "xhigh" | "medium",
			});
			break;
		}
		case "codex": {
			if (resolvedEffort !== effort) {
				console.warn(
					`  ⚠ Effort "${effort}" is not supported by codex; using "${resolvedEffort}" (highest supported).`,
				);
			}

			inner = io.codex(model, {
				captureSessions: false,
				effort: resolvedEffort as "low" | "high" | "xhigh" | "medium",
			});
			break;
		}
		case "copilot": {
			const copilotEffort =
				effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
			if (copilotEffort !== effort) {
				console.warn(
					`  ⚠ Effort "${effort}" is not supported by copilot; using "${copilotEffort}" (highest supported).`,
				);
			}

			inner = io.copilot(model, {
				effort: copilotEffort,
			});
			break;
		}
		case "cursor": {
			console.warn(`  ⚠ Effort "${effort}" is not supported by cursor; ignoring.`);
			inner = io.cursor(model, {});
			break;
		}
		case "dirac": {
			// Dirac natively supports "max" (OPENAI_REASONING_EFFORT_OPTIONS), so no downgrade.
			inner = diracAgent(model, {
				effort: resolvedEffort,
				env: {
					OPENAI_API_BASE: process.env.OPENAI_API_BASE ?? "https://router.bynara.id/v1",
					OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
				},
			});
			break;
		}
		case "opencode": {
			console.warn(`  ⚠ Effort "${effort}" is not supported by opencode; ignoring.`);
			inner = io.opencode(model, {});
			break;
		}
		case "pi": {
			if (resolvedEffort !== effort) {
				console.warn(
					`  ⚠ Effort "${effort}" is not supported by pi; using "${resolvedEffort}" (highest supported).`,
				);
			}

			inner = io.pi(model, {
				captureSessions: false,
				thinking: resolvedEffort as "low" | "high" | "xhigh" | "medium",
			});
			break;
		}
	}

	return withMarkerCompletion(inner, markerPath);
}

export function issueView(issueNumber: string): string {
	return config.issueCommand.replaceAll("{issue}", issueNumber);
}

export function fetchIssueLabels(issueNumber: string): Array<string> {
	try {
		const output = io
			.execSync(`${issueView(issueNumber)} --json labels`, {
				cwd: repoRoot,
				encoding: "utf-8",
			})
			.toString();
		const payload = JSON.parse(output) as { labels?: Array<{ name?: string }> };
		return (payload.labels ?? []).map((label) => label.name ?? "").filter(Boolean);
	} catch {
		return [];
	}
}

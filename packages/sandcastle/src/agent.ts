/*
 * Agent providers (dirac plus the @ai-hero/sandcastle backends) and the
 * prompt-context helpers that build skills lists and fetch issue metadata.
 */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { config, io, packageRoot, repoRoot } from "./runtime.js";
import type { AgentBackend, PhaseName, SandcastleEffort } from "./types.js";

/** Protocol line printed by `assets/agent-wrapper.sh` after a marker-backed run finishes. */
const MARKER_PROTOCOL_LINE = '{"sandcastleMarker":"completed"}';

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

/**
 * Backend effort levels. "max" is accepted as a user-facing alias and maps to "xhigh", which is the
 * highest level the dirac/pi CLIs support.
 */
export function resolveBackendEffort(effort: string): SandcastleEffort {
	return effort === "max" ? "xhigh" : (effort as SandcastleEffort);
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
					? ` --reasoning-effort ${resolveBackendEffort(options.effort)}`
					: "";
			const wrapperPath = `${packageRoot}/assets/dirac-wrapper.sh`.replaceAll("\\", "/");
			return {
				/*
				 * The wrapper captures stdin to a temp file and passes it as a CLI
				 * argument with stdin from /dev/null, avoiding Ink's raw-mode error.
				 */
				command: `bash ${wrapperPath} --json${yoloFlag}${effortFlag} ${provider} -m ${JSON.stringify(model)}`,
				stdin: prompt,
			};
		},

		parseStreamLine(line: string): Array<StreamEvent> {
			try {
				const parsed = JSON.parse(line);
				const events: Array<StreamEvent> = [];

				if (
					parsed.content?.type === "markdown" &&
					parsed.content.isReasoning === false &&
					parsed.content.role !== "user"
				) {
					const rawContent = parsed.content.content;
					const newText = typeof rawContent === "string" ? rawContent : "";
					if (newText !== "") {
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

/**
 * Wraps any @ai-hero/sandcastle provider with marker-based completion.
 *
 * The inner provider's command is executed through `assets/agent-wrapper.sh`, which checks the
 * completion marker after a clean exit and prints a protocol line. This proxy uses that line to
 * flush the accumulated stream output as a final result event, so structured output like the
 * `<plan>` block survives even when intermediate card results overwrite the orchestrator's
 * `resultText`.
 */
export function withMarkerCompletion(inner: AgentProvider, markerPath: string): AgentProvider {
	const markerEnv = {
		SANDCASTLE_MARKER_COMPLETED: markerPath.replaceAll("\\", "/"),
	};
	const wrapperPath = `${packageRoot}/assets/agent-wrapper.sh`.replaceAll("\\", "/");
	let textBuffer = "";
	let resultEmitted = false;

	const parseProtocol = (line: string): Array<StreamEvent> => {
		if (resultEmitted || line.trim() !== MARKER_PROTOCOL_LINE) {
			return [];
		}

		resultEmitted = true;
		return [{ type: "result", result: textBuffer }];
	};

	return {
		...(inner.buildInteractiveArgs !== undefined
			? { buildInteractiveArgs: inner.buildInteractiveArgs }
			: {}),
		buildPrintCommand(options): PrintCommand {
			const innerCommand = inner.buildPrintCommand(options);
			const useStdin = innerCommand.stdin !== undefined;
			const command = `bash ${shellEscape(wrapperPath)}${useStdin ? " --stdin" : ""} -- ${shellEscape(innerCommand.command)}`;
			return {
				command,
				stdin: options.prompt,
			};
		},
		captureSessions: inner.captureSessions,
		env: { ...inner.env, ...markerEnv },
		name: inner.name,
		...(inner.parseSessionUsage !== undefined
			? { parseSessionUsage: inner.parseSessionUsage }
			: {}),
		parseStreamLine(line: string): Array<StreamEvent> {
			const innerEvents = inner.parseStreamLine(line);
			for (const event of innerEvents) {
				if (event.type === "text") {
					textBuffer += event.text;
				} else if (event.type === "result") {
					textBuffer += event.result;
				}
			}

			return [...innerEvents, ...parseProtocol(line)];
		},
		sessionStorage: inner.sessionStorage,
	};
}

/** Single-quote a value for use inside a `bash` command string. */
function shellEscape(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function createAgent(
	backend: AgentBackend,
	model: string,
	effort: string,
	markerPath: string,
): AgentProvider {
	const resolvedEffort = resolveBackendEffort(effort);
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
			if (resolvedEffort !== effort) {
				console.warn(
					`  ⚠ Effort "${effort}" is not supported by dirac; using "${resolvedEffort}" (highest supported).`,
				);
			}

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

const globalPhaseSkills: Record<PhaseName, ReadonlyArray<string>> = config.skills.defaults;
const issueLabelSkills: Record<string, Partial<Record<PhaseName, ReadonlyArray<string>>>> = config
	.skills.labels;

export const uniqueSkills = (skills: ReadonlyArray<string>): Array<string> => [...new Set(skills)];

export function skillsForPrompt(phase: PhaseName, labels: ReadonlyArray<string> = []): string {
	const skills = [...globalPhaseSkills[phase]];
	for (const label of labels) {
		for (const skill of issueLabelSkills[label]?.[phase] ?? []) {
			skills.push(skill);
		}
	}

	return uniqueSkills(skills)
		.map((skill) => `- ${skill}`)
		.join("\n");
}

/** Returns the configured issue-view command with `{issue}` replaced. */
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

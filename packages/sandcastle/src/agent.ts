/*
 * Agent providers (pi and dirac) plus the prompt-context helpers that build
 * skills lists and fetch issue metadata for prompt substitution.
 */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { config, io, packageRoot, repoRoot } from "./runtime.js";
import type { AgentBackend, PhaseName, SandcastleEffort } from "./types.js";

/**
 * Backend effort levels. "max" is accepted as a user-facing alias and maps to "xhigh", which is the
 * highest level the dirac/pi CLIs support.
 */
export function resolveBackendEffort(effort: string): SandcastleEffort {
	return effort === "max" ? "xhigh" : (effort as SandcastleEffort);
}

type DiracStreamEvent =
	| { text: string; type: "text" }
	| { result: string; type: "result" }
	| {
			type: "usage";
			usage: {
				cacheCreationInputTokens: number;
				cacheReadInputTokens: number;
				inputTokens: number;
				outputTokens: number;
			};
	  };

let diracTextBuffer = "";
let diracSignalEmitted = false;
let diracCompletionSignal = "";

export function diracAgent(
	model: string,
	options?: {
		completionSignal?: string;
		effort?: string;
		env?: Record<string, string>;
	},
): AgentProvider {
	// Store the runtime-generated signal for parseStreamLine detection
	diracCompletionSignal = options?.completionSignal ?? "<promise>COMPLETE</promise>";

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

		parseStreamLine(line: string): Array<DiracStreamEvent> {
			try {
				const parsed = JSON.parse(line);
				const events: Array<DiracStreamEvent> = [];

				// Reset buffer at the start of a new task
				if (parsed.type === "task_started") {
					diracTextBuffer = "";
					diracSignalEmitted = false;
				}

				if (parsed.content?.type === "markdown" && parsed.content.isReasoning === false) {
					/*
					 * Only accumulate assistant text for signal detection.
					 * User prompt may contain the signal as an example.
					 */
					if (parsed.content.role !== "user") {
						const rawContent = parsed.content.content;
						const newText = typeof rawContent === "string" ? rawContent : "";
						diracTextBuffer += newText;

						/*
						 * Only flag completion when the CURRENT block contains
						 * the signal — avoids false positives from earlier
						 * mentions of the signal lingering in the buffer.
						 */
						if (!diracSignalEmitted && newText.includes(diracCompletionSignal)) {
							diracSignalEmitted = true;
							events.push({ type: "result", result: diracTextBuffer });
						}
					}

					/*
					 * Only emit text events for assistant content.
					 * User prompt text must NOT flow into accumulatedOutput
					 * because it contains the completion UUID, which would
					 * cause the sandcastle library to detect completion
					 * immediately and start the 60s grace timer prematurely.
					 */
					if (parsed.content.role !== "user") {
						events.push({ type: "text", text: parsed.content.content });
					}
				}

				/*
				 * After completion signal is seen, skip card results — they
				 * overwrite resultText and would lose the <plan> content.
				 */
				if (
					!diracSignalEmitted &&
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
	completionSignal?: string,
): AgentProvider {
	const resolvedEffort = resolveBackendEffort(effort);
	if (resolvedEffort !== effort) {
		console.warn(
			`  ⚠ Effort "${effort}" is not supported by ${backend}; using "${resolvedEffort}" (highest supported).`,
		);
	}

	if (backend === "pi") {
		return io.pi(model, {
			captureSessions: false,
			thinking: resolvedEffort as "low" | "high" | "xhigh" | "medium",
		});
	}

	return diracAgent(model, {
		completionSignal,
		effort: resolvedEffort,
		env: {
			OPENAI_API_BASE: process.env.OPENAI_API_BASE ?? "https://router.bynara.id/v1",
			OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
		},
	});
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

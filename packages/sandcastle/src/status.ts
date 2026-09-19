/*
 * Human-readable status report for a single issue.
 */

import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { issueMetadata } from "./issue-metadata.js";
import { evaluatePhases } from "./evaluate.js";
import { config, repoRoot } from "./runtime.js";
import { readState } from "./state.js";
import type { AgentPhaseName, PhaseName, ResolvedAgentStep } from "./types.js";

export function printStatus(
	issueNumber: string,
	model: string | Record<PhaseName, string>,
	baseRef?: string,
	worktree?: string,
	steps?: Record<AgentPhaseName, ResolvedAgentStep>,
): void {
	const branchName = `sandcastle/issue-${issueNumber}`;
	const worktreePath =
		worktree ??
		pathResolve(repoRoot, config.dir, "worktrees", `sandcastle-issue-${issueNumber}`);
	const state = readState(issueNumber);

	// Fetch issue title.
	const issueTitle = issueMetadata(issueNumber).title;

	const eval_ = evaluatePhases(issueNumber, model, { baseRef, resume: true });

	console.log(`\nIssue #${issueNumber}: ${issueTitle}`);
	console.log(`Branch: ${branchName}`);
	console.log(`Worktree: ${existsSync(worktreePath) ? "exists" : "missing"}`);
	const statusModel = typeof model === "string" ? model : model.implement;
	const stateModelNote =
		state !== undefined && state.model !== statusModel ? ` (state: ${state.model})` : "";
	console.log(`Model: ${statusModel}${stateModelNote}`);
	if (steps) {
		for (const step of ["design", "implement", "review"] as const) {
			const resolved = steps[step];
			if (resolved)
				{console.log(
					`  ${step}: ${resolved.agentBackend}/${resolved.model} (${resolved.effort})`,
				);}
		}
	}

	console.log();

	// Table header.
	console.log(`${"Phase".padEnd(12)} ${"Status".padEnd(10)} ${"Decision".padEnd(10)} Reason`);
	console.log(`${"─".repeat(12)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(40)}`);

	for (const phase of ["design", "implement", "review"] as Array<PhaseName>) {
		const record = state?.phases[phase];
		const status = record?.status ?? "pending";
		const decision = eval_[phase];
		const reason = eval_.reasons[phase];
		console.log(
			`${phase.padEnd(12)} ${status.padEnd(10)} ${decision.toUpperCase().padEnd(10)} ${reason}`,
		);
	}

	console.log();
	console.log(`Resume with: pnpm sandcastle:issue -- --issue ${issueNumber} --resume`);
}

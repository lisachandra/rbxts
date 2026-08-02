/*
 * Human-readable status report for a single issue.
 */

import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { issueView } from "./agent.js";
import { evaluatePhases } from "./evaluate.js";
import { config, io, repoRoot } from "./runtime.js";
import { readState } from "./state.js";
import type { PhaseName } from "./types.js";

export function printStatus(
	issueNumber: string,
	model: string,
	baseRef?: string,
	worktree?: string,
): void {
	const branchName = `sandcastle/issue-${issueNumber}`;
	const worktreePath =
		worktree ??
		pathResolve(repoRoot, config.dir, "worktrees", `sandcastle-issue-${issueNumber}`);
	const state = readState(issueNumber);

	// Fetch issue title.
	let issueTitle = "";
	try {
		issueTitle = io
			.execSync(`${issueView(issueNumber)} --json title --jq .title`, {
				encoding: "utf-8",
			})
			.toString()
			.trim();
	} catch {
		issueTitle = "(could not fetch)";
	}

	const eval_ = evaluatePhases(issueNumber, model, { baseRef, resume: true });

	console.log(`\nIssue #${issueNumber}: ${issueTitle}`);
	console.log(`Branch: ${branchName}`);
	console.log(`Worktree: ${existsSync(worktreePath) ? "exists" : "missing"}`);
	const stateModelNote =
		state !== undefined && state.model !== model ? ` (state: ${state.model})` : "";
	console.log(`Model: ${model}${stateModelNote}`);
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

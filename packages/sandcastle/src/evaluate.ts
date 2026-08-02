/*
 * Phase evaluator: decides skip/start/force for each of Design → Implement →
 * Review by inspecting actual artifacts on disk. Resilient to stale state
 * files — checks plan files, commits, and build status.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { countNewCommits } from "./git.js";
import { config, repoRoot } from "./runtime.js";
import { readState } from "./state.js";
import type { EvaluationResult, PhaseDecision, PhaseName, PhaseState } from "./types.js";

export function evaluatePhases(
	issueNumber: string,
	model: string,
	opts: {
		baseRef?: string;
		force?: true | PhaseName;
		phase?: PhaseName;
		resume: boolean;
		worktree?: string;
	},
): EvaluationResult {
	void opts.resume;
	const planFile = pathResolve(repoRoot, config.dir, "plans", `${issueNumber}.md`);
	const worktreePath =
		opts.worktree ??
		pathResolve(repoRoot, config.dir, "worktrees", `sandcastle-issue-${issueNumber}`);
	const state = readState(issueNumber);
	const baseRef = opts.baseRef ?? state?.base?.ref ?? config.baseBranch;
	const reasons: Record<PhaseName, string> = { design: "", implement: "", review: "" };

	// If --phase is specified, only evaluate that phase; skip the others.
	if (opts.phase) {
		const result: EvaluationResult = {
			design: "skip",
			implement: "skip",
			reasons,
			review: "skip",
		};
		result[opts.phase] = evaluateSinglePhase(
			opts.phase,
			issueNumber,
			model,
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		);
		if (opts.force === true || opts.force === opts.phase) {
			result[opts.phase] = "force";
			reasons[opts.phase] = "forced by --force flag";
		}

		return result;
	}

	// Full evaluation of all three phases.
	const result: EvaluationResult = {
		design: evaluateSinglePhase(
			"design",
			issueNumber,
			model,
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		),
		implement: evaluateSinglePhase(
			"implement",
			issueNumber,
			model,
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		),
		reasons,
		review: evaluateSinglePhase(
			"review",
			issueNumber,
			model,
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		),
	};

	// Apply --force override.
	if (opts.force !== undefined) {
		if (opts.force === true) {
			// Force all phases.
			for (const p of ["design", "implement", "review"] as Array<PhaseName>) {
				result[p] = "force";
				reasons[p] = "forced by --force flag";
			}
		} else {
			result[opts.force] = "force";
			reasons[opts.force] = "forced by --force flag";
		}
	}

	return result;
}

function evaluateSinglePhase(
	phase: PhaseName,
	issueNumber: string,
	model: string,
	state: undefined | PhaseState,
	planFile: string,
	worktreePath: string,
	baseRef: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	switch (phase) {
		case "design": {
			return evaluateDesign(state, planFile, worktreePath, reasons);
		}
		case "implement": {
			return evaluateImplement(
				state,
				model,
				planFile,
				worktreePath,
				issueNumber,
				baseRef,
				reasons,
			);
		}
		case "review": {
			return evaluateReview(state, issueNumber, baseRef, worktreePath, reasons);
		}
	}
}

export function evaluateDesign(
	state: undefined | PhaseState,
	planFile: string,
	worktreePath: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	// Check both repo-root and worktree locations for the plan file.
	const planFileName = planFile.split(/[\\/]/).pop()!;
	const worktreePlanFile = pathResolve(worktreePath, config.dir, "plans", planFileName);
	const resolvedPlan = existsSync(planFile)
		? planFile
		: existsSync(worktreePlanFile)
			? worktreePlanFile
			: undefined;

	if (resolvedPlan === undefined || resolvedPlan === "") {
		reasons.design = "plan file does not exist";
		return "start";
	}

	try {
		const content = readFileSync(resolvedPlan, "utf-8").trim();
		if (content.length === 0) {
			reasons.design = "plan file is empty";
			return "start";
		}

		// Check for expected structure — at minimum a heading.
		if (!content.includes("#") && !content.includes("##")) {
			reasons.design = "plan file has no headings (possibly malformed)";
			return "start";
		}
	} catch {
		reasons.design = "plan file unreadable";
		return "start";
	}

	// Plan file exists and looks valid.
	if (state?.phases.design.status === "done") {
		reasons.design = `plan file exists at ${resolvedPlan} and design phase marked done`;
		return "skip";
	}

	reasons.design = `plan file exists at ${resolvedPlan} (state file missing or incomplete)`;
	return "skip";
}

export function evaluateImplement(
	state: undefined | PhaseState,
	model: string,
	planFile: string,
	worktreePath: string,
	_issueNumber: string,
	baseRef: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	// Design must be done first — check both repo-root and worktree.
	const planFileName = planFile.split(/[\\/]/).pop()!;
	const worktreePlanFile = pathResolve(worktreePath, config.dir, "plans", planFileName);
	if (!existsSync(planFile) && !existsSync(worktreePlanFile)) {
		reasons.implement = "blocked — plan file does not exist (design phase needed)";
		return "skip";
	}

	// Check if worktree exists.
	if (!existsSync(worktreePath)) {
		reasons.implement = "worktree does not exist";
		return "start";
	}

	// Check for commits beyond the base branch.
	const newCommits = countNewCommits(worktreePath, baseRef);
	if (newCommits === 0) {
		reasons.implement = "no new commits in worktree";
		return "start";
	}

	// If model changed, restart implementation.
	if (state?.phases.implement.status === "done" && state.model !== model) {
		reasons.implement = `model changed (${state.model} → ${model})`;
		return "start";
	}

	// Check if build passes.
	if (state?.phases.implement.status === "done") {
		reasons.implement = `${newCommits} commits, build previously passed`;
		return "skip";
	}

	// State says failed — restart.
	if (state?.phases.implement.status === "failed") {
		reasons.implement = `previous attempt failed: ${state.lastError ?? "unknown error"}`;
		return "start";
	}

	// No state file but commits exist — likely a partial run.
	reasons.implement = `${newCommits} commits exist but no state record`;
	return "start";
}

export function evaluateReview(
	state: undefined | PhaseState,
	_issueNumber: string,
	baseRef: string,
	worktreePath: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	// Implement must have produced commits.
	if (state?.phases.implement.status !== "done") {
		// Check if there are commits anyway (state might be stale).
		if (!existsSync(worktreePath) || countNewCommits(worktreePath, baseRef) === 0) {
			reasons.review = "blocked — implementation has no commits";
			return "skip";
		}

		reasons.review = "implementation has commits (state file missing)";
		return "start";
	}

	// Already reviewed.
	if (state?.phases.review.status === "done") {
		reasons.review = "review already completed";
		return "skip";
	}

	reasons.review = "implementation done, review needed";
	return "start";
}

export function createFreshPhaseEvaluation(): EvaluationResult {
	return {
		design: "start",
		implement: "start",
		reasons: {
			design: "fresh run",
			implement: "fresh run",
			review: "fresh run",
		},
		review: "start",
	};
}

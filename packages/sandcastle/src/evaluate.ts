/*
 * Phase evaluator: decides skip/start/force for each of Design → Implement →
 * Review by inspecting actual artifacts on disk. Resilient to stale state
 * files — checks plan files, commits, and build status.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { countNewCommits, issueBranch } from "./git.js";
import { config, repoRoot, worktreePathForBranch } from "./runtime.js";
import { isReviewComplete, readState } from "./state.js";
import type { EvaluationResult, PhaseDecision, PhaseName, PhaseState } from "./types.js";

export function evaluatePhases(
	issueNumber: string,
	models: string | Record<PhaseName, string>,
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
	const worktreePath = opts.worktree ?? worktreePathForBranch(issueBranch(issueNumber));
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
			modelForPhase(models, opts.phase),
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
			modelForPhase(models, "design"),
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		),
		implement: evaluateSinglePhase(
			"implement",
			issueNumber,
			modelForPhase(models, "implement"),
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
			modelForPhase(models, "review"),
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

/** Normalizes the `models` arg: a single workflow model or a per-phase map. */
function modelForPhase(models: string | Record<PhaseName, string>, phase: PhaseName): string {
	return typeof models === "string" ? models : (models[phase] ?? "");
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

/**
 * - Resolves which copy of an issue's plan is authoritative.
 * - @param planFile - Repo-root plan path, as `runSingleIssue` builds it.
 * - @param worktreePath - The issue's worktree.
 * - @returns The worktree copy when present, otherwise the repo-root one, otherwise `undefined`.
 * - @remarks The worktree comes first because that copy travels with the branch: an issue's plan is
 *   committed there, so its own branch is the authority on what it was designed to do. The
 *   repo-root copy is what a `--phase` run writes before any commit exists, and a leftover from an
 *   earlier run of the same issue number must not shadow the branch's current plan.
 */
function resolvePlanFile(planFile: string, worktreePath: string): string | undefined {
	const planFileName = planFile.split(/[\\/]/).pop()!;
	const worktreePlanFile = pathResolve(worktreePath, config.dir, "plans", planFileName);
	if (existsSync(worktreePlanFile)) {
		return worktreePlanFile;
	}

	return existsSync(planFile) ? planFile : undefined;
}

export function evaluateDesign(
	state: undefined | PhaseState,
	planFile: string,
	worktreePath: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	const resolvedPlan = resolvePlanFile(planFile, worktreePath);

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
	// Design must be done first — the plan travels with the branch, so the worktree wins.
	if (resolvePlanFile(planFile, worktreePath) === undefined) {
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

	/*
	 * If model changed, restart implementation.
	 * If the implement model changed (or a legacy single-model state moved to per-phase
	 * config), restart implementation. Per-phase overrides live in state.phasesConfig.
	 */
	const implementModel = state?.phasesConfig?.implement?.model ?? state?.model;
	if (state?.phases.implement.status === "done" && implementModel !== model) {
		reasons.implement = `model changed (${implementModel} → ${model})`;
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

	// Already reviewed — or skipped because there was nothing to review.
	if (isReviewComplete(state)) {
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

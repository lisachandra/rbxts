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
	/*
	 * The model no longer decides anything. A completed implement phase used to re-run whenever the
	 * resolved model differed from the one recorded on the state, so an unrelated config edit — or an
	 * expiring promotional window — redid work that had already passed review. Only `--force` re-runs a
	 * finished phase now. The parameter stays because callers pass it and this is a package export.
	 */
	void models;
	const input: PhaseEvaluationInput = {
		baseRef: "",
		issueNumber,
		planFile: pathResolve(repoRoot, config.dir, "plans", `${issueNumber}.md`),
		state: readState(issueNumber),
		worktreePath: opts.worktree ?? worktreePathForBranch(issueBranch(issueNumber)),
	};
	input.baseRef = opts.baseRef ?? input.state?.base?.ref ?? config.baseBranch;

	const reasons: Record<PhaseName, string> = { design: "", implement: "", review: "" };
	/** Runs one rule through the table and records its reason in place. */
	const decide = (phase: PhaseName): PhaseDecision => {
		const evaluation = evaluatePhase(phase, input);
		reasons[phase] = evaluation.reason;
		return evaluation.decision;
	};

	// If --phase is specified, only evaluate that phase; skip the others.
	if (opts.phase) {
		const result: EvaluationResult = {
			design: "skip",
			implement: "skip",
			reasons,
			review: "skip",
		};
		result[opts.phase] = decide(opts.phase);
		if (opts.force === true || opts.force === opts.phase) {
			result[opts.phase] = "force";
			reasons[opts.phase] = "forced by --force flag";
		}

		return result;
	}

	const result: EvaluationResult = {
		design: decide("design"),
		implement: decide("implement"),
		reasons,
		review: decide("review"),
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

/**
 * - Absolute path of an issue's plan as the designing agent writes it inside its worktree.
 * - @param worktreePath - The issue's worktree.
 * - @param issueNumber - Issue number; names the plan file.
 * - @returns `<worktree>/<config.dir>/plans/<issueNumber>.md`.
 * - @remarks The agents' `cwd` is the worktree, so this is the one path a designer and an implementer
 *   can both open without deciding what a relative `.sandcastle/plans/…` means.
 */
export function worktreePlanPath(worktreePath: string, issueNumber: string): string {
	return pathResolve(worktreePath, config.dir, "plans", `${issueNumber}.md`);
}

/**
 * - Resolves which copy of an issue's plan is authoritative.
 * - @param planFile - Repo-root plan path.
 * - @param worktreePath - The issue's worktree.
 * - @returns The worktree copy when present, otherwise the repo-root one, otherwise `undefined`.
 * - @remarks The worktree comes first because that copy travels with the branch: an issue's plan is
 *   committed there, so its own branch is the authority on what it was designed to do. The
 *   repo-root copy is what a `--phase` run writes before any commit exists, and a leftover from an
 *   earlier run of the same issue number must not shadow the branch's current plan.
 */
export function resolvePlanFile(planFile: string, worktreePath: string): string | undefined {
	const planFileName = planFile.split(/[\\/]/).pop()!;
	const worktreePlanFile = pathResolve(worktreePath, config.dir, "plans", planFileName);
	if (existsSync(worktreePlanFile)) {
		return worktreePlanFile;
	}

	return existsSync(planFile) ? planFile : undefined;
}

/** Everything one phase's skip/start decision reads. */
export interface PhaseEvaluationInput {
	baseRef: string;
	issueNumber: string;
	/** Repo-root plan path; the worktree copy wins when it exists. */
	planFile: string;
	state: undefined | PhaseState;
	worktreePath: string;
}

/** One phase's decision and the sentence that explains it. */
export interface PhaseEvaluation {
	decision: PhaseDecision;
	reason: string;
}

/** A decision rule: read the input, answer, and let the caller record the reason. */
type PhaseEvaluator = (input: PhaseEvaluationInput) => PhaseEvaluation;

/**
 * Design is done when a plan exists and looks like one.
 *
 * @remarks
 *   The plan is the artifact, not the state file: a plan on disk from a run whose state was lost
 *   still means design succeeded, and re-planning over it would discard the work.
 */
function evaluateDesign(input: PhaseEvaluationInput): PhaseEvaluation {
	const resolvedPlan = resolvePlanFile(input.planFile, input.worktreePath);

	if (resolvedPlan === undefined || resolvedPlan === "") {
		return { decision: "start", reason: "plan file does not exist" };
	}

	try {
		const content = readFileSync(resolvedPlan, "utf-8").trim();
		if (content.length === 0) {
			return { decision: "start", reason: "plan file is empty" };
		}

		// Check for expected structure — at minimum a heading.
		if (!content.includes("#") && !content.includes("##")) {
			return {
				decision: "start",
				reason: "plan file has no headings (possibly malformed)",
			};
		}
	} catch {
		return { decision: "start", reason: "plan file unreadable" };
	}

	if (input.state?.phases.design.status === "done") {
		return {
			decision: "skip",
			reason: `plan file exists at ${resolvedPlan} and design phase marked done`,
		};
	}

	return {
		decision: "skip",
		reason: `plan file exists at ${resolvedPlan} (state file missing or incomplete)`,
	};
}

/** Implement is done when commits exist and the state says the build passed. */
function evaluateImplement(input: PhaseEvaluationInput): PhaseEvaluation {
	// Design must be done first — the plan travels with the branch, so the worktree wins.
	const resolvedPlan = resolvePlanFile(input.planFile, input.worktreePath);
	if (resolvedPlan === undefined) {
		/*
		 * Name both paths a plan could have been at. The old one-liner said only "does not exist",
		 * which reads as harmless next to a design phase that just reported success — so a plan
		 * written to a third path looked like a normal continuation instead of the bug it was.
		 */
		return {
			decision: "skip",
			reason: `blocked — no plan at ${worktreePlanPath(input.worktreePath, input.issueNumber)} or ${input.planFile}`,
		};
	}

	if (!existsSync(input.worktreePath)) {
		return { decision: "start", reason: "worktree does not exist" };
	}

	const newCommits = countNewCommits(input.worktreePath, input.baseRef);
	if (newCommits === 0) {
		return { decision: "start", reason: "no new commits in worktree" };
	}

	if (input.state?.phases.implement.status === "done") {
		return {
			decision: "skip",
			reason: `${String(newCommits)} commits, build previously passed`,
		};
	}

	if (input.state?.phases.implement.status === "failed") {
		return {
			decision: "start",
			reason: `previous attempt failed: ${input.state.lastError ?? "unknown error"}`,
		};
	}

	// No state file but commits exist — likely a partial run.
	return {
		decision: "start",
		reason: `${String(newCommits)} commits exist but no state record`,
	};
}

/** Review is done when `isReviewComplete` says so; it needs implement's commits to exist. */
function evaluateReview(input: PhaseEvaluationInput): PhaseEvaluation {
	if (input.state?.phases.implement.status !== "done") {
		// Check if there are commits anyway (state might be stale).
		if (
			!existsSync(input.worktreePath) ||
			countNewCommits(input.worktreePath, input.baseRef) === 0
		) {
			return { decision: "skip", reason: "blocked — implementation has no commits" };
		}

		return { decision: "start", reason: "implementation has commits (state file missing)" };
	}

	// Already reviewed — or skipped because there was nothing to review.
	if (isReviewComplete(input.state)) {
		return { decision: "skip", reason: "review already completed" };
	}

	return { decision: "start", reason: "implementation done, review needed" };
}

/**
 * The three phases' decision rules.
 *
 * @remarks
 *   A table rather than a `switch`, so adding a phase-shaped step is a row and a change to a shared
 *   input reaches every rule at once. The order is the run order.
 */
const phaseEvaluators: Record<PhaseName, PhaseEvaluator> = {
	design: evaluateDesign,
	implement: evaluateImplement,
	review: evaluateReview,
};

/**
 * - Decides whether one phase should run, and why.
 * - @param phase - Which phase.
 * - @param input - The on-disk facts every rule reads.
 * - @returns The decision and its one-sentence reason.
 * - @remarks Pure; callers do the I/O of gathering `input` and the policy of `--force`.
 */
export function evaluatePhase(phase: PhaseName, input: PhaseEvaluationInput): PhaseEvaluation {
	return phaseEvaluators[phase](input);
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

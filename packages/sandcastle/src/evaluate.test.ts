import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

import { evaluatePhase, evaluatePhases, type PhaseEvaluationInput } from "./evaluate.js";
import {
	cleanupIssueArtifacts,
	makeState,
	plansDir,
	registerTestHooks,
	stubExecSync,
	stubGitRevList,
	tmpRoot,
	uniqueIssue,
	writePlan,
} from "./test-helpers.js";

registerTestHooks();

/**
 * The evaluation input for one phase, with the fields a given spec does not care about defaulted.
 *
 * The three rules are driven through `evaluatePhase` rather than three exported functions: the
 * suite is driven by that table, which is what makes "a change to a shared input reaches every
 * phase" provable rather than asserted.
 */
function inputFor(
	fields: Partial<PhaseEvaluationInput> & Pick<PhaseEvaluationInput, "planFile" | "worktreePath">,
): PhaseEvaluationInput {
	return {
		baseRef: "main",
		issueNumber: "0",
		state: undefined,
		...fields,
	};
}

/** Design's decision and reason for the call shape the specs below use. */
function design(
	state: PhaseEvaluationInput["state"],
	planFile: string,
	worktreePath: string,
	reasons: Record<string, string>,
): string {
	const evaluation = evaluatePhase("design", inputFor({ planFile, state, worktreePath }));
	reasons.design = evaluation.reason;
	return evaluation.decision;
}

/** Implement's decision and reason. */
function implement(
	state: PhaseEvaluationInput["state"],
	planFile: string,
	worktreePath: string,
	issueNumber: string,
	reasons: Record<string, string>,
): string {
	const evaluation = evaluatePhase(
		"implement",
		inputFor({ issueNumber, planFile, state, worktreePath }),
	);
	reasons.implement = evaluation.reason;
	return evaluation.decision;
}

/** Review's decision and reason. */
function review(
	state: PhaseEvaluationInput["state"],
	issueNumber: string,
	worktreePath: string,
	reasons: Record<string, string>,
): string {
	const evaluation = evaluatePhase(
		"review",
		inputFor({
			issueNumber,
			planFile: join(plansDir, `${issueNumber}.md`),
			state,
			worktreePath,
		}),
	);
	reasons.review = evaluation.reason;
	return evaluation.decision;
}

describe("phase evaluation", () => {
	test("evaluateDesign handles missing, empty, malformed, and valid plans", () => {
		const issue = uniqueIssue();
		const planFile = join(plansDir, `${issue}.md`);
		const worktree = join(tmpRoot, `wt-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(design(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /does not exist/);

		writePlan(issue, "   ");
		assert.equal(design(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /empty/);

		writePlan(issue, "no headings here");
		assert.equal(design(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /no headings/);

		writePlan(issue, "# Plan\n\nDo the thing.");
		assert.equal(design(undefined, planFile, worktree, reasons), "skip");
		assert.match(reasons.design, /missing or incomplete/);

		const state = makeState(issue, { design: "done" });
		assert.equal(design(state, planFile, worktree, reasons), "skip");
		assert.match(reasons.design, /marked done/);

		cleanupIssueArtifacts(issue);
	});

	test("evaluateDesign prefers the worktree plan over a stale repo-root copy", () => {
		/*
		 * Plans are committed on the issue branch, so that copy is the authority. A leftover plan in
		 * the primary checkout — from an earlier run of the same issue number — must not shadow it.
		 */
		const issue = uniqueIssue();
		const planFile = join(plansDir, `${issue}.md`);
		const worktree = join(tmpRoot, `wt-precedence-${issue}`);
		const worktreePlan = join(worktree, ".sandcastle", "plans", `${issue}.md`);
		const reasons = { design: "", implement: "", review: "" };

		// A valid repo-root plan exists, so this would be "skip" if the root copy won.
		writePlan(issue, "# Stale plan\n\nFrom an earlier run.");
		mkdirSync(join(worktree, ".sandcastle", "plans"), { recursive: true });
		writeFileSync(worktreePlan, "no headings", "utf-8");

		// The worktree copy is the one read, and it is malformed — so design must start.
		assert.equal(design(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /no headings/);

		writeFileSync(worktreePlan, "# Branch plan\n\nCurrent.", "utf-8");
		assert.equal(design(undefined, planFile, worktree, reasons), "skip");
		assert.match(reasons.design, new RegExp(issue, "u"));

		// With no worktree copy, the repo-root plan still answers (a --phase run before any commit).
		rmSync(worktreePlan, { force: true });
		assert.equal(design(undefined, planFile, worktree, reasons), "skip");
		assert.match(reasons.design, /missing or incomplete/);

		rmSync(worktree, { force: true, recursive: true });
		cleanupIssueArtifacts(issue);
	});

	test("evaluateImplement covers plan/worktree/commits/state paths", () => {
		const issue = uniqueIssue();
		const planFile = join(plansDir, `${issue}.md`);
		const worktree = join(tmpRoot, `wt-impl-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(implement(undefined, planFile, worktree, issue, reasons), "skip");

		writePlan(issue, "# Plan");
		assert.equal(implement(undefined, planFile, worktree, issue, reasons), "start");
		assert.match(reasons.implement, /worktree does not exist/);

		mkdirSync(worktree, { recursive: true });
		/*
		 * `countNewCommits` reads commits through argv (`git rev-list …`), not a shell string, so the
		 * stub has to answer `execFileSync`. Answering `execSync` here would leave every worktree
		 * reading as "0 new commits" and the assertions below would pass for the wrong reason.
		 */
		stubGitRevList(() => {
			throw new Error("git failed");
		});

		assert.equal(implement(undefined, planFile, worktree, issue, reasons), "start");
		assert.match(reasons.implement, /no new commits/);

		stubGitRevList("2");
		assert.equal(implement(undefined, planFile, worktree, issue, reasons), "start");
		assert.match(reasons.implement, /no state record/);

		/*
		 * A completed implement stays done whatever the model: the phase used to re-run whenever the
		 * resolved model differed from the recorded one, so a config edit — or a model that stopped
		 * being available — redid work that had already passed review. Only `--force` re-runs now.
		 */
		const done = makeState(issue, { implement: "done", model: "old" });
		assert.equal(implement(done, planFile, worktree, issue, reasons), "skip");
		assert.match(reasons.implement, /build previously passed/);

		const failed = makeState(issue, { implement: "failed" });
		assert.equal(implement(failed, planFile, worktree, issue, reasons), "start");
		assert.match(reasons.implement, /previous attempt failed/);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("evaluateReview covers blocked, stale commits, done, and needed", () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `wt-review-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(review(undefined, issue, worktree, reasons), "skip");

		mkdirSync(worktree, { recursive: true });
		stubGitRevList("1");
		assert.equal(review(undefined, issue, worktree, reasons), "start");

		const implementDone = makeState(issue, { implement: "done" });
		assert.equal(review(implementDone, issue, worktree, reasons), "start");

		const reviewDone = makeState(issue, { implement: "done", review: "done" });
		assert.equal(review(reviewDone, issue, worktree, reasons), "skip");

		rmSync(worktree, { force: true, recursive: true });
	});

	test("evaluatePhases supports phase isolation and force overrides", () => {
		const issue = uniqueIssue();
		writePlan(issue, "# Plan");
		stubExecSync("0");

		const isolated = evaluatePhases(issue, "m", {
			force: "implement",
			phase: "implement",
			resume: true,
		});
		assert.equal(isolated.design, "skip");
		assert.equal(isolated.implement, "force");
		assert.equal(isolated.review, "skip");

		const forcedAll = evaluatePhases(issue, "m", { force: true, resume: false });
		assert.equal(forcedAll.design, "force");
		assert.equal(forcedAll.implement, "force");
		assert.equal(forcedAll.review, "force");

		const forcedOne = evaluatePhases(issue, "m", { force: "review", resume: false });
		assert.equal(forcedOne.review, "force");

		cleanupIssueArtifacts(issue);
	});
});

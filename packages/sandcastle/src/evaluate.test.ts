/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { evaluateDesign, evaluateImplement, evaluatePhases, evaluateReview } from "./evaluate.js";
import { io } from "./runtime.js";
import {
	cleanupIssueArtifacts,
	makeState,
	plansDir,
	registerTestHooks,
	stubExecSync,
	tmpRoot,
	uniqueIssue,
	writePlan,
} from "./test-helpers.js";

registerTestHooks();

describe("phase evaluation", () => {
	test("evaluateDesign handles missing, empty, malformed, and valid plans", () => {
		const issue = uniqueIssue();
		const planFile = join(plansDir, `${issue}.md`);
		const worktree = join(tmpRoot, `wt-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(evaluateDesign(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /does not exist/);

		writePlan(issue, "   ");
		assert.equal(evaluateDesign(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /empty/);

		writePlan(issue, "no headings here");
		assert.equal(evaluateDesign(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /no headings/);

		writePlan(issue, "# Plan\n\nDo the thing.");
		assert.equal(evaluateDesign(undefined, planFile, worktree, reasons), "skip");
		assert.match(reasons.design, /missing or incomplete/);

		const state = makeState(issue, { design: "done" });
		assert.equal(evaluateDesign(state, planFile, worktree, reasons), "skip");
		assert.match(reasons.design, /marked done/);

		cleanupIssueArtifacts(issue);
	});

	test("evaluateImplement covers plan/worktree/commits/model/fail paths", () => {
		const issue = uniqueIssue();
		const planFile = join(plansDir, `${issue}.md`);
		const worktree = join(tmpRoot, `wt-impl-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(
			evaluateImplement(undefined, "m", planFile, worktree, issue, "main", reasons),
			"skip",
		);

		writePlan(issue, "# Plan");
		assert.equal(
			evaluateImplement(undefined, "m", planFile, worktree, issue, "main", reasons),
			"start",
		);
		assert.match(reasons.implement, /worktree does not exist/);

		mkdirSync(worktree, { recursive: true });
		io.execSync = () => {
			throw new Error("git failed");
		};

		assert.equal(
			evaluateImplement(undefined, "m", planFile, worktree, issue, "main", reasons),
			"start",
		);
		assert.match(reasons.implement, /no new commits/);

		stubExecSync("2");
		assert.equal(
			evaluateImplement(undefined, "m", planFile, worktree, issue, "main", reasons),
			"start",
		);
		assert.match(reasons.implement, /no state record/);

		const done = makeState(issue, { implement: "done", model: "old" });
		assert.equal(
			evaluateImplement(done, "new", planFile, worktree, issue, "main", reasons),
			"start",
		);
		assert.match(reasons.implement, /model changed/);

		const same = makeState(issue, { implement: "done", model: "same" });
		assert.equal(
			evaluateImplement(same, "same", planFile, worktree, issue, "main", reasons),
			"skip",
		);

		const failed = makeState(issue, { implement: "failed" });
		assert.equal(
			evaluateImplement(failed, "m", planFile, worktree, issue, "main", reasons),
			"start",
		);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("evaluateReview covers blocked, stale commits, done, and needed", () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `wt-review-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(evaluateReview(undefined, issue, "main", worktree, reasons), "skip");

		mkdirSync(worktree, { recursive: true });
		stubExecSync("1");
		assert.equal(evaluateReview(undefined, issue, "main", worktree, reasons), "start");

		const implementDone = makeState(issue, { implement: "done" });
		assert.equal(evaluateReview(implementDone, issue, "main", worktree, reasons), "start");

		const reviewDone = makeState(issue, { implement: "done", review: "done" });
		assert.equal(evaluateReview(reviewDone, issue, "main", worktree, reasons), "skip");

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

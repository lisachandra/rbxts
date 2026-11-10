/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { chainBreaks } from "./chain.js";

describe("queue chain containment", () => {
	/** Builds the seams from a literal branch map and ancestry set — no git, no filesystem. */
	function seams(
		branches: Record<string, string>,
		tips: Record<string, string>,
		ancestors: ReadonlyArray<readonly [string, string]>,
	): Parameters<typeof chainBreaks>[1] {
		const pairs = new Set(ancestors.map(([commit, ref]) => `${commit}:${ref}`));
		return {
			branchTipOf: (branch) => tips[branch],
			isAncestor: (commit, ref) => pairs.has(`${commit}:${ref}`),
			memberBranch: (issue) => branches[issue],
		};
	}

	test("reports nothing when every member branch contains its predecessor", () => {
		const lines = chainBreaks(
			[{ issues: ["5", "6", "7"], name: "U2" }],
			seams(
				{ "5": "sandcastle/issue-5", "6": "sandcastle/issue-6", "7": "sandcastle/issue-7" },
				{
					"sandcastle/issue-5": "aaa",
					"sandcastle/issue-6": "bbb",
					"sandcastle/issue-7": "ccc",
				},
				[
					["aaa", "bbb"],
					["aaa", "ccc"],
					["bbb", "ccc"],
				],
			),
		);

		assert.deepEqual(lines, []);
	});

	test("names the first member whose branch does not contain its predecessor's tip", () => {
		/*
		 * The #594 → #644 → #596 shape: a member inserted after #594 chains its branch, but the
		 * completed #596 predates the insertion, so its branch does not contain #644's tip.
		 */
		const lines = chainBreaks(
			[{ issues: ["594", "644", "596"], name: "matchmaking-session-work" }],
			seams(
				{
					"594": "sandcastle/issue-594",
					"596": "sandcastle/issue-596",
					"644": "sandcastle/issue-644",
				},
				{
					"sandcastle/issue-594": "aaa",
					"sandcastle/issue-596": "bbb",
					"sandcastle/issue-644": "ccc",
				},
				[
					["aaa", "bbb"],
					["aaa", "ccc"],
				],
			),
		);

		assert.equal(lines.length, 1);
		assert.match(lines[0] ?? "", /Chain break in batch "matchmaking-session-work"/u);
		assert.match(lines[0] ?? "", /sandcastle\/issue-596 \(#596\) does not contain/u);
		assert.match(lines[0] ?? "", /sandcastle\/issue-644 \(#644\)/u);
		assert.match(lines[0] ?? "", /queue remove --issue 596/u, "the refusal names the fix");
	});

	test("skips members without a branch and never reports the first member", () => {
		// #5 was never dispatched (no state, no branch); #6 chains from #5's predecessor slot.
		const lines = chainBreaks(
			[{ issues: ["5", "6"], name: "U2" }],
			seams({ "6": "sandcastle/issue-6" }, { "sandcastle/issue-6": "bbb" }, []),
		);

		assert.deepEqual(lines, []);
	});

	test("a branch that does not resolve is skipped, so a fresh batch reports nothing", () => {
		const lines = chainBreaks(
			[{ issues: ["5", "6"], name: "U2" }],
			seams(
				{ "5": "sandcastle/issue-5", "6": "sandcastle/issue-6" },
				{ "sandcastle/issue-5": "aaa" },
				[],
			),
		);

		assert.deepEqual(lines, []);
	});
});

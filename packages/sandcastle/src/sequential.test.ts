/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { issueBranch } from "./git.js";
import { markerPath } from "./markers.js";
import { worktreePathForBranch } from "./runtime.js";
import { type DispatchIssue, reclaimMemberWorktree, runSequentialIssues } from "./sequential.js";
import { writeState } from "./state.js";
import {
	cleanupIssueArtifacts,
	ExitError,
	gitStub,
	makeState,
	registerTestHooks,
	repositoryRoot,
	stubExit,
	stubRun,
	tmpRoot,
	uniqueIssue,
	writePlan,
} from "./test-helpers.js";

registerTestHooks();

describe("sequential issue workflow", () => {
	test("runSequentialIssues empty throws; blocked and failed exit", async () => {
		await assert.rejects(
			async () => runSequentialIssues([], "main", "m", "low", "dirac", false),
			/At least one/,
		);

		const issue = uniqueIssue();
		// Resume-skip checks the default sandcastle worktree path when no --worktree is supplied.
		const worktree = join(
			repositoryRoot,
			".sandcastle",
			"worktrees",
			`sandcastle-issue-${issue}`,
		);
		/*
		 * Deliberately absent: the worktree is what a cleanup removes, and the skip has to work without
		 * it. Recreating one here would be the bug this pins — a re-fired batch re-creating a full
		 * checkout for every member it only means to skip.
		 */
		rmSync(worktree, { force: true, recursive: true });
		writePlan(issue, "# Plan");
		writeState(
			makeState(issue, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);

		const calls: Array<Array<string>> = [];
		const codes = stubExit();
		gitStub({
			file: (args) => {
				calls.push([...args]);
				if (args[0] === "show-ref") {
					return "";
				}

				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: APPROVED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				if (command.includes("gh issue view")) {
					return JSON.stringify({ labels: [], title: "title" });
				}

				return "";
			},
		});

		// Resume skip path for completed issue, then no blocked/failed.
		await runSequentialIssues([issue], "main", "test-model", "low", "dirac", true);
		assert.deepEqual(codes, []);
		assert.equal(
			calls.some((args) => args[0] === "worktree" && args[1] === "add"),
			false,
			"a skipped member must not have its worktree recreated",
		);

		// Failed path.
		const failingIssue = uniqueIssue();
		gitStub({
			file: () => {
				throw new Error("boom");
			},
			sync: () => {
				throw new Error("boom");
			},
		});
		await assert.rejects(
			async () => runSequentialIssues([failingIssue], "main", "m", "low", "dirac", false),
			(err: unknown) => err instanceof ExitError && err.code === 1,
		);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runSequentialIssues aborts on blocked review", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `seq-block-${issue}`);
		mkdirSync(worktree, { recursive: true });
		writePlan(issue, "# Plan");

		const codes = stubExit();
		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: BLOCKED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				if (command.includes("gh issue view")) {
					return JSON.stringify({ labels: [], title: "title" });
				}

				return "";
			},
		});
		stubRun(
			{
				commits: [{ sha: "c1" }],
				stdout: "ok",
			},
			[
				markerPath(`${issue}.design`),
				markerPath(`${issue}.implement`),
				markerPath(`${issue}.review`),
			],
		);

		await assert.rejects(
			async () =>
				runSequentialIssues([issue], "main", "model", "low", "dirac", false, { worktree }),
			(err: unknown) => err instanceof ExitError && err.code === 1,
		);
		assert.equal(codes.at(-1), 1);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("skips a landed member whose branch survives only on origin, and restores it", async () => {
		const issue = uniqueIssue();
		writePlan(issue, "# Plan");
		writeState(
			makeState(issue, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);

		const calls: Array<Array<string>> = [];
		stubExit();
		gitStub({
			file: (args) => {
				calls.push([...args]);
				// The local branch is gone; only `origin/<branch>` resolves.
				if (
					args[0] === "show-ref" &&
					args.includes(`refs/heads/sandcastle/issue-${issue}`)
				) {
					throw new Error("no local branch");
				}

				if (args[0] === "show-ref") {
					return "";
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: APPROVED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				return JSON.stringify({ labels: [], title: "title" });
			},
		});

		await runSequentialIssues([issue], "main", "test-model", "low", "dirac", true);

		assert.ok(
			calls.some(
				(args) =>
					args[0] === "branch" &&
					args[1] === "--track" &&
					args[2] === `sandcastle/issue-${issue}`,
			),
			"the local branch is restored from origin so the chain base resolves",
		);
		assert.equal(
			calls.some((args) => args[0] === "worktree" && args[1] === "add"),
			false,
			"restoring the branch must not create a worktree",
		);

		cleanupIssueArtifacts(issue);
	});
});

describe("live dispatch", () => {
	/**
	 * A member stub: records the dispatch and chains the member's own branch, reporting reuse for
	 * the members it is told to. Replaces the phase pipeline, so no git or agent runs here.
	 */
	function memberStub(
		dispatched: Array<string>,
		reused: ReadonlySet<string> = new Set(),
	): DispatchIssue {
		return async ({ issueNumber }) => {
			dispatched.push(issueNumber);
			return reused.has(issueNumber)
				? {
						nextBase: issueBranch(issueNumber),
						result: { issue: issueNumber, reused: true, status: "ok" },
						stop: false,
					}
				: {
						nextBase: issueBranch(issueNumber),
						result: { issue: issueNumber, status: "ok" },
						stop: false,
					};
		};
	}

	test("a follow-up registered mid-run dispatches next with the reviewed branch as base", async () => {
		/*
		 * The order starts [first, second]; first's review registers a follow-up after it, so the
		 * re-read hands the walk [first, newcomer, second]: the follow-up dispatches with first's
		 * branch as base, and second after it — the insertion is never bypassed.
		 */
		const first = uniqueIssue();
		const second = uniqueIssue();
		const newcomer = uniqueIssue();
		let order = [first, second];
		let registered = false;
		const dispatched: Array<string> = [];
		const bases = new Map<string, string>();

		const results = await runSequentialIssues(
			[first, second],
			"main",
			"test-model",
			"low",
			"dirac",
			true,
			{
				dispatchIssue: async ({ currentBase, issueNumber }) => {
					dispatched.push(issueNumber);
					bases.set(issueNumber, currentBase);
					if (issueNumber === first && !registered) {
						registered = true;
						order = [first, newcomer, second];
					}

					return {
						nextBase: issueBranch(issueNumber),
						result: { issue: issueNumber, status: "ok" },
						stop: false,
					};
				},
				nextOrder: () => [...order],
			},
		);

		assert.deepEqual(dispatched, [first, newcomer, second]);
		assert.deepEqual(
			bases.get(newcomer),
			issueBranch(first),
			"the follow-up chains the member whose review registered it",
		);
		assert.deepEqual(
			results.map((result) => result.issue),
			[first, newcomer, second],
		);
	});

	test("completed members are reuse-chained inline without forcing a re-read", async () => {
		/*
		 * Reused members run no agent, so they cannot change the manifest: the walk continues
		 * through them in one pass, and the order is consulted exactly once for a reuse-only batch.
		 */
		const first = uniqueIssue();
		let consultations = 0;
		const dispatched: Array<string> = [];

		const results = await runSequentialIssues(
			[first],
			"main",
			"test-model",
			"low",
			"dirac",
			true,
			{
				dispatchIssue: memberStub(dispatched, new Set([first])),
				nextOrder: () => {
					consultations += 1;
					return [first];
				},
			},
		);

		assert.deepEqual(dispatched, [first]);
		assert.deepEqual(
			results.map((result) => result.reused),
			[true],
		);
		assert.equal(consultations, 1);
	});

	test("stops when the batch order no longer contains the member it chained from", async () => {
		const first = uniqueIssue();
		const second = uniqueIssue();
		let order = [first, second];
		const dispatched: Array<string> = [];

		const results = await runSequentialIssues(
			[first, second],
			"main",
			"test-model",
			"low",
			"dirac",
			true,
			{
				dispatchIssue: memberStub(dispatched),
				nextOrder: () => {
					// Simulates `queue remove` pulling the dispatched member out mid-run.
					if (dispatched.length > 0) {
						order = order.filter((issue) => issue !== first);
					}

					return [...order];
				},
			},
		);

		assert.deepEqual(dispatched, [first], "the walk stops instead of guessing the chain");
		assert.deepEqual(
			results.map((result) => result.issue),
			[first],
		);
	});

	test("--max-issues budget stops the live walk before it overshoots", async () => {
		const first = uniqueIssue();
		const second = uniqueIssue();
		const third = uniqueIssue();
		const dispatched: Array<string> = [];

		const results = await runSequentialIssues(
			[first, second, third],
			"main",
			"test-model",
			"low",
			"dirac",
			true,
			{
				budget: 1,
				dispatchIssue: memberStub(dispatched),
				nextOrder: () => [first, second, third],
			},
		);

		assert.deepEqual(dispatched, [first], "the batch stops instead of running unbudgeted work");
		assert.deepEqual(
			results.map((result) => result.issue),
			[first],
		);
	});
});

describe("chain rewind guard", () => {
	/** Stubs a reuse-eligible member whose branch tip is `bbb`, with the accumulated base at `aaa`. */
	function stubRewindingGit(member: string, baseBranch: string): void {
		const baseRef = `refs/heads/${baseBranch}^{commit}`;
		const memberFull = `refs/heads/sandcastle/issue-${member}^{commit}`;
		gitStub({
			file: (args) => {
				if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
					// The base commit is not an ancestor of the reused tip: the chain rewinds.
					throw new Error("not an ancestor");
				}

				if (args[0] === "show-ref") {
					return "";
				}

				if (args[0] === "rev-parse" && args[2] === baseRef) {
					return "aaa111122223333444455556666777788889999";
				}

				if (args[0] === "rev-parse" && args[2] === memberFull) {
					return "bbb111122223333444455556666777788889999";
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: APPROVED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				return "";
			},
		});
	}

	function captureWarn(): { lines: Array<string>; restore: () => void } {
		const lines: Array<string> = [];
		const original = console.warn;
		console.warn = (...args: ReadonlyArray<unknown>) => {
			lines.push(args.map(String).join(" "));
		};

		return {
			lines,
			restore: (): void => {
				console.warn = original;
			},
		};
	}

	test("warns and continues when a reused member's branch rewinds the chain", async () => {
		const member = uniqueIssue();
		writeState(
			makeState(member, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);
		stubRewindingGit(member, "sandcastle/issue-other");
		const { lines, restore } = captureWarn();
		const codes = stubExit();

		try {
			await runSequentialIssues(
				[member],
				"sandcastle/issue-other",
				"m",
				"low",
				"dirac",
				true,
			);

			assert.deepEqual(codes, [], "a rewind warns by default; it does not fail the run");
			assert.ok(
				lines.some((line) => line.includes("rewinds the chain")),
				"the warning names the rewound base",
			);
		} finally {
			restore();
			cleanupIssueArtifacts(member);
		}
	});

	test("aborts under --strict-chain when a reused member's branch rewinds the chain", async () => {
		const member = uniqueIssue();
		writeState(
			makeState(member, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);
		stubRewindingGit(member, "sandcastle/issue-other");
		const codes = stubExit();

		await assert.rejects(
			async () =>
				runSequentialIssues([member], "sandcastle/issue-other", "m", "low", "dirac", true, {
					strictChain: true,
				}),
			(err: unknown) => err instanceof ExitError && err.code === 1,
		);

		cleanupIssueArtifacts(member);
	});
});

describe("immediate push-and-delete", () => {
	/** Records every git invocation the reclaim makes, in order. */
	function recordingGit(statusOutput = ""): Array<Array<string>> {
		const calls: Array<Array<string>> = [];
		gitStub({
			file: (args) => {
				calls.push([...args]);
				if (args[0] === "status") {
					return statusOutput;
				}

				return "";
			},
		});
		return calls;
	}

	/**
	 * The runner's own worktree path for a branch, created on disk. A real directory, so the
	 * removal path runs rather than short-circuiting on a missing path, carrying the `.git` marker
	 * file a worktree has — without it the directory is not a worktree git can remove.
	 */
	function runnerWorktree(branch: string): string {
		const path = worktreePathForBranch(branch);
		mkdirSync(path, { recursive: true });
		writeFileSync(
			join(path, ".git"),
			`gitdir: ${join(repositoryRoot, ".git", "worktrees", branch)}\n`,
			"utf-8",
		);
		return path;
	}

	test("pushes the branch before the worktree is removed", () => {
		/*
		 * The ordering is the whole point: the push is what makes the worktree disposable, so a
		 * removal that ran first would delete the only copy of the work it was protecting.
		 */
		const calls = recordingGit();
		const branch = "sandcastle/issue-42";
		const path = runnerWorktree(branch);

		reclaimMemberWorktree({ branch, issue: "42", worktreePath: path });

		const push = calls.findIndex((args) => args[0] === "push");
		const remove = calls.findIndex((args) => args[0] === "worktree" && args[1] === "remove");
		assert.notEqual(push, -1, "the branch was pushed");
		assert.notEqual(remove, -1, "the worktree was removed");
		assert.ok(push < remove, "push ran before the removal");

		rmSync(path, { force: true, recursive: true });
	});

	test("pushes a dirty member but keeps its worktree", () => {
		/*
		 * `dirtyPaths` reads `status --porcelain --untracked-files=no`; a review's uncommitted
		 * corrections live only in the worktree, so they have to survive the cleanup. The committed
		 * work still goes to origin — that is the durable half.
		 */
		const calls = recordingGit(" M src/a.ts\n");
		const branch = "sandcastle/issue-43";
		const path = runnerWorktree(branch);

		reclaimMemberWorktree({ branch, issue: "43", worktreePath: path });

		assert.equal(
			calls.some((args) => args[0] === "push"),
			true,
			"the committed work is pushed even when the worktree stays",
		);
		assert.equal(
			calls.some((args) => args[0] === "worktree" && args[1] === "remove"),
			false,
			"the worktree is kept",
		);
		assert.equal(existsSync(path), true, "and it is still on disk");

		rmSync(path, { force: true, recursive: true });
	});

	test("does nothing when the worktree is already gone", () => {
		const calls = recordingGit();

		reclaimMemberWorktree({
			branch: "sandcastle/issue-44",
			issue: "44",
			worktreePath: worktreePathForBranch("sandcastle/issue-44"),
		});

		assert.deepEqual(calls, [], "an absent worktree needs no push and no removal");
	});

	test("leaves a worktree the runner did not place alone", () => {
		/*
		 * `--worktree <path>` points at a worktree the caller made, so it is not this runner's to
		 * delete; `queue clean` refuses a foreign path for the same reason.
		 */
		const calls = recordingGit();
		const path = join(tmpRoot, "reclaim", "handmade");
		mkdirSync(path, { recursive: true });

		reclaimMemberWorktree({
			branch: "sandcastle/issue-45",
			issue: "45",
			worktreePath: path,
		});

		assert.deepEqual(calls, [], "a hand-made worktree is never pushed for or removed");
		assert.equal(existsSync(path), true, "and it is still there");

		rmSync(path, { force: true, recursive: true });
	});
});

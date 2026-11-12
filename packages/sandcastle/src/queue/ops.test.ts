import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

import { parseArgs } from "../cli.js";
import { config, io } from "../runtime.js";
import { writeState } from "../state.js";
import {
	cleanupIssueArtifacts,
	makeState,
	registerTestHooks,
	tmpRoot,
	uniqueIssue,
} from "../test-helpers.js";
import { manifestLockName, queueLockPath } from "./lock.js";
import { emptyQueueManifest, type QueueManifest, writeQueueManifest } from "./manifest.js";
import { runQueueAdd, runQueueRule, runQueueSequence } from "./ops.js";

registerTestHooks();

const primary = join(tmpRoot, "ops-primary");
const relativeManifest = "sandcastle.queue.ops.json";
const manifestPath = join(primary, relativeManifest);

/** Stubs `git rev-parse` so the manifest resolves into the test checkout, and captures output. */
function stage(manifest: QueueManifest): { done: () => void; lines: Array<string> } {
	rmSync(manifestPath, { force: true });
	rmSync(queueLockPath(manifestLockName), { force: true });
	config.queue.file = relativeManifest;
	config.queue.commit = false;
	config.queue.lease = "off";
	writeQueueManifest(manifest, manifestPath);
	io.execFileSync = ((command: string, args?: string | ReadonlyArray<string>) => {
		const argv = Array.isArray(args) ? args.map(String) : [];
		if (command === "git" && argv[0] === "rev-parse") {
			return join(primary, ".git");
		}

		throw new Error(`unexpected execFileSync: ${command} ${argv.join(" ")}`);
	}) as typeof io.execFileSync;

	const lines: Array<string> = [];
	const original = console.log;
	console.log = (...args: ReadonlyArray<unknown>) => {
		lines.push(args.map(String).join(" "));
	};

	return {
		done: (): void => {
			console.log = original;
		},
		lines,
	};
}

function written(): QueueManifest {
	return JSON.parse(readFileSync(manifestPath, "utf-8")) as QueueManifest;
}

describe("queue ops", () => {
	/** Stubs the checkout so `currentSandcastleIssue` resolves to the given member, if any. */
	function stubMemberWorktree(issue: string | undefined): void {
		io.execFileSync = ((command: string, args?: string | ReadonlyArray<string>) => {
			const argv = Array.isArray(args) ? args.map(String) : [];
			if (command === "git" && argv[0] === "branch" && argv[1] === "--show-current") {
				return issue === undefined ? "main" : `sandcastle/issue-${issue}`;
			}

			if (command === "git" && argv[0] === "rev-parse") {
				return join(primary, ".git");
			}

			throw new Error(`unexpected execFileSync: ${command} ${argv.join(" ")}`);
		}) as typeof io.execFileSync;
	}

	test("runQueueAdd refuses an insertion ahead of a completed member", () => {
		const anchor = uniqueIssue();
		const completed = uniqueIssue();
		const newcomer = uniqueIssue();
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: [anchor, completed], name: "progression-work" }],
		});
		// Complete: the dispatcher reuse-chains this member's pre-insertion branch, bypassing the newcomer.
		writeState(
			makeState(completed, {
				commits: ["abc"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);

		try {
			assert.throws(() => {
				runQueueAdd(
					parseArgs([
						"queue",
						"add",
						"--issue",
						newcomer,
						"--sequence",
						"progression-work",
						"--after",
						anchor,
					]),
				);
			}, /already completed/u);

			// The refusal aborts the transaction: the manifest on disk is unchanged.
			assert.deepEqual(written().sequences[0]?.issues, [anchor, completed]);
		} finally {
			output.done();
			cleanupIssueArtifacts(completed);
		}
	});

	test("runQueueAdd allows inserting ahead of a dispatched-but-incomplete member", () => {
		/*
		 * Live dispatch re-reads the batch order before each member, so the insertion dispatches in
		 * the same run — what a review registering a follow-up after its own in-flight issue needs.
		 */
		const anchor = uniqueIssue();
		const inFlight = uniqueIssue();
		const newcomer = uniqueIssue();
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: [anchor, inFlight], name: "progression-work" }],
		});
		// A state file exists (dispatched), but the phases are unfinished — not reuse-eligible.
		writeState(makeState(inFlight));

		try {
			runQueueAdd(
				parseArgs([
					"queue",
					"add",
					"--issue",
					newcomer,
					"--sequence",
					"progression-work",
					"--after",
					anchor,
				]),
			);

			assert.deepEqual(written().sequences[0]?.issues, [anchor, newcomer, inFlight]);
		} finally {
			output.done();
			cleanupIssueArtifacts(inFlight);
		}
	});

	test("runQueueAdd refuses an agent anchoring --after at a member that is not its own", () => {
		const anchor = uniqueIssue();
		const own = uniqueIssue();
		const newcomer = uniqueIssue();
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: [anchor, own], name: "progression-work" }],
		});
		stubMemberWorktree(own);

		try {
			assert.throws(
				() => {
					runQueueAdd(
						parseArgs([
							"queue",
							"add",
							"--issue",
							newcomer,
							"--sequence",
							"progression-work",
							"--after",
							anchor,
						]),
					);
				},
				new RegExp(`not your own issue \\(#${own}\\)`, "u"),
			);

			// The refusal happens before the transaction: the manifest on disk is unchanged.
			assert.deepEqual(written().sequences[0]?.issues, [anchor, own]);
		} finally {
			output.done();
		}
	});

	test("runQueueAdd allows an agent anchoring --after at its own issue", () => {
		const own = uniqueIssue();
		const newcomer = uniqueIssue();
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: [own], name: "progression-work" }],
		});
		stubMemberWorktree(own);

		try {
			runQueueAdd(
				parseArgs([
					"queue",
					"add",
					"--issue",
					newcomer,
					"--sequence",
					"progression-work",
					"--after",
					own,
				]),
			);

			assert.deepEqual(written().sequences[0]?.issues, [own, newcomer]);
			assert.ok(output.lines.some((line) => line.includes(`#${newcomer}`)));
		} finally {
			output.done();
		}
	});

	test("runQueueAdd appends to the tail even when earlier members were dispatched", () => {
		const first = uniqueIssue();
		const second = uniqueIssue();
		const newcomer = uniqueIssue();
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: [first, second], name: "progression-work" }],
		});
		writeState(makeState(first));
		writeState(makeState(second));

		try {
			runQueueAdd(
				parseArgs(["queue", "add", "--issue", newcomer, "--sequence", "progression-work"]),
			);

			// A tail append chains the last member's branch; no dispatched member sits behind it.
			assert.deepEqual(written().sequences[0]?.issues, [first, second, newcomer]);
			assert.ok(output.lines.some((line) => line.includes(`#${newcomer}`)));
		} finally {
			output.done();
			cleanupIssueArtifacts(first);
			cleanupIssueArtifacts(second);
		}
	});

	test("runQueueRule --delete retires every rule with the name and prints what it removed", () => {
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: ["1"], name: "U2" }],
			serialized: [
				{ issues: ["295", "386"], name: "R2", reason: "same file" },
				{ issues: ["432", "292", "293"], name: "R2", reason: "same file" },
				{ issues: ["1", "2"], reason: "unnamed" },
			],
		});

		try {
			runQueueRule(parseArgs(["queue", "rule", "--delete", "--name", "R2"]));

			assert.deepEqual(written().serialized, [{ issues: ["1", "2"], reason: "unnamed" }]);
			assert.ok(
				output.lines.some((line) =>
					line.includes(
						"Retired 2 serialization rule(s): R2 (295, 386), R2 (432, 292, 293)",
					),
				),
			);
		} finally {
			output.done();
		}
	});

	test("runQueueRule --delete with an unknown rule fails naming it and writes nothing", () => {
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: ["1"], name: "U2" }],
			serialized: [{ issues: ["1", "2"], name: "R2", reason: "same file" }],
		});

		try {
			assert.throws(() => {
				runQueueRule(parseArgs(["queue", "rule", "--delete", "--name", "R9"]));
			}, /No serialization rule matches name "R9"/u);
			assert.equal(written().serialized.length, 1);
		} finally {
			output.done();
		}
	});

	test("runQueueSequence refuses a redefinition that moves a dispatched member", () => {
		const first = uniqueIssue();
		const second = uniqueIssue();
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: [first, second], name: "progression-work" }],
		});
		writeState(makeState(first));

		try {
			assert.throws(() => {
				runQueueSequence(
					parseArgs([
						"queue",
						"sequence",
						"--name",
						"progression-work",
						"--issues",
						`${second},${first}`,
					]),
				);
			}, /moves it behind/u);

			// The refusal aborts the transaction: the manifest on disk keeps the run order.
			assert.deepEqual(written().sequences[0]?.issues, [first, second]);
		} finally {
			output.done();
			cleanupIssueArtifacts(first);
		}
	});

	test("runQueueSequence appends new work after the dispatched prefix", () => {
		const first = uniqueIssue();
		const second = uniqueIssue();
		const newcomer = uniqueIssue();
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: [first, second], name: "progression-work" }],
		});
		writeState(makeState(first));
		writeState(makeState(second));

		try {
			runQueueSequence(
				parseArgs([
					"queue",
					"sequence",
					"--name",
					"progression-work",
					"--issues",
					`${first},${second},${newcomer}`,
				]),
			);

			assert.deepEqual(written().sequences[0]?.issues, [first, second, newcomer]);
			assert.ok(output.lines.some((line) => line.includes("Defined sequence")));
		} finally {
			output.done();
			cleanupIssueArtifacts(first);
			cleanupIssueArtifacts(second);
		}
	});
});

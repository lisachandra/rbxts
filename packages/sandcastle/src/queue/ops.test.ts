/*
 * `queue ops` — the mutations, asserted as (message, resulting manifest) pairs.
 *
 * A mutation's contract is that pair: the line the operator reads and the manifest the transaction
 * settled on. Asserting a helper call instead would only re-test the pure mutations that
 * `mutations.test.ts` already covers, and asserting a file on disk would need the whole process
 * pointed at a different manifest — which is what this suite used to do, and what the injected
 * context exists to stop.
 *
 * The refusals — gated, blocked, mid-chain — stay here because they are the mutation's own
 * guardrails: they run *inside* the transaction, against the manifest it just read, which is the
 * only place the check cannot race a concurrent writer.
 */

import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { parseArgs } from "../cli.js";
import { writeState } from "../state.js";
import {
	cleanupIssueArtifacts,
	makeState,
	registerTestHooks,
	uniqueIssue,
} from "../test-helpers.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";
import { runQueueAdd, runQueuePromote, runQueueRule, runQueueSequence } from "./ops.js";
import { fakeQueueContext, humanText, type QueueContextStub } from "./test-helpers.js";

registerTestHooks();

/** A manifest with one batch, for the specs that need a placement to exist already. */
function withSequence(issues: ReadonlyArray<string>, name = "progression-work"): QueueManifest {
	return { ...emptyQueueManifest(), sequences: [{ issues: [...issues], name }] };
}

/** The single batch's member order, which is what most specs assert. */
function members(stub: QueueContextStub): ReadonlyArray<string> {
	return stub.current().sequences[0]?.issues ?? [];
}

describe("queue ops", () => {
	test("queue add places an issue and reports the placement", () => {
		const issue = uniqueIssue();
		const stub = fakeQueueContext(withSequence(["100"]));

		runQueueAdd(
			parseArgs(["queue", "add", "--issue", issue, "--sequence", "progression-work"]),
			stub.context,
		);

		assert.deepEqual(members(stub), ["100", issue]);
		assert.match(humanText(stub.fake), new RegExp(`✓ Placed #${issue} → `, "u"));
		assert.equal(stub.fake.persisted.length, 1, "exactly one manifest write");
		assert.equal(
			stub.fake.persisted[0]?.summary,
			`place #${issue} in the queue`,
			"the commit subject says what happened",
		);
	});

	test("queue add reports where an already-placed issue came from", () => {
		/*
		 * Placement history is the reason the message is built inside the transaction rather than by the
		 * caller: only the manifest that was read knows where the issue used to be. A `human` entry is the
		 * case that can move — a sequence member must be removed first, so `addToSequence` refuses it —
		 * which makes this the branch where the "was …" clause is actually reachable.
		 */
		const issue = uniqueIssue();
		const stub = fakeQueueContext({
			...emptyQueueManifest(),
			human: [{ issue, reason: "needs a decision" }],
			sequences: [{ issues: ["100"], name: "progression-work" }],
		});

		runQueueAdd(
			parseArgs(["queue", "add", "--issue", issue, "--sequence", "progression-work"]),
			stub.context,
		);

		assert.match(humanText(stub.fake), /Moved \(was human\)/u);
		assert.deepEqual(members(stub), ["100", issue]);
		assert.equal(
			stub.current().human.length,
			0,
			"the human entry moved, rather than being copied",
		);
	});

	test("queue add refuses an insertion ahead of a completed member", () => {
		const anchor = uniqueIssue();
		const completed = uniqueIssue();
		const newcomer = uniqueIssue();
		const stub = fakeQueueContext(withSequence([anchor, completed]));
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
					stub.context,
				);
			}, /already completed/u);

			// The refusal aborts the transaction: nothing was persisted.
			assert.deepEqual(stub.fake.persisted, []);
			assert.deepEqual(members(stub), [anchor, completed]);
		} finally {
			cleanupIssueArtifacts(completed);
		}
	});

	test("queue add allows inserting ahead of a dispatched-but-incomplete member", () => {
		/*
		 * Live dispatch re-reads the batch order before each member, so the insertion dispatches in
		 * the same run — what a review registering a follow-up after its own in-flight issue needs.
		 */
		const anchor = uniqueIssue();
		const inFlight = uniqueIssue();
		const newcomer = uniqueIssue();
		const stub = fakeQueueContext(withSequence([anchor, inFlight]));
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
				stub.context,
			);

			assert.deepEqual(members(stub), [anchor, newcomer, inFlight]);
		} finally {
			cleanupIssueArtifacts(inFlight);
		}
	});

	test("queue add appends to the tail even when earlier members were dispatched", () => {
		const first = uniqueIssue();
		const second = uniqueIssue();
		const newcomer = uniqueIssue();
		const stub = fakeQueueContext(withSequence([first, second]));
		writeState(makeState(first));
		writeState(makeState(second));

		try {
			runQueueAdd(
				parseArgs(["queue", "add", "--issue", newcomer, "--sequence", "progression-work"]),
				stub.context,
			);

			// A tail append chains the last member's branch; no dispatched member sits behind it.
			assert.deepEqual(members(stub), [first, second, newcomer]);
		} finally {
			cleanupIssueArtifacts(first);
			cleanupIssueArtifacts(second);
		}
	});

	test("queue add with no placement is a no-op the transaction does not write", () => {
		/*
		 * `--gated` with no reason still places the issue in the gated bucket, so the genuinely empty
		 * mutation is removing something that is not there. Whatever the route, "returned the manifest
		 * it was given" must mean "wrote nothing" — that is the rule that keeps `queue prune` from
		 * dirtying a clean checkout.
		 */
		const stub = fakeQueueContext(emptyQueueManifest());

		assert.throws(() => {
			runQueueAdd(parseArgs(["queue", "add"]), stub.context);
		}, /requires --issue/u);
		assert.deepEqual(stub.fake.transactions, [], "the refusal is before the transaction");
	});

	test("queue rule --delete retires every rule with the name and prints what it removed", () => {
		const stub = fakeQueueContext({
			...emptyQueueManifest(),
			sequences: [{ issues: ["1"], name: "U2" }],
			serialized: [
				{ issues: ["295", "386"], name: "R2", reason: "same file" },
				{ issues: ["432", "292", "293"], name: "R2", reason: "same file" },
				{ issues: ["1", "2"], reason: "unnamed" },
			],
		});

		runQueueRule(parseArgs(["queue", "rule", "--delete", "--name", "R2"]), stub.context);

		assert.deepEqual(stub.current().serialized, [{ issues: ["1", "2"], reason: "unnamed" }]);
		assert.match(
			humanText(stub.fake),
			/Retired 2 serialization rule\(s\): R2 \(295, 386\), R2 \(432, 292, 293\)/u,
		);
	});

	test("queue rule --delete with an unknown rule fails naming it and writes nothing", () => {
		const stub = fakeQueueContext({
			...emptyQueueManifest(),
			sequences: [{ issues: ["1"], name: "U2" }],
			serialized: [{ issues: ["1", "2"], name: "R2", reason: "same file" }],
		});

		assert.throws(() => {
			runQueueRule(parseArgs(["queue", "rule", "--delete", "--name", "R9"]), stub.context);
		}, /No serialization rule matches name "R9"/u);
		assert.deepEqual(stub.fake.persisted, []);
	});

	test("queue sequence refuses a redefinition that moves a dispatched member", () => {
		const first = uniqueIssue();
		const second = uniqueIssue();
		const stub = fakeQueueContext(withSequence([first, second]));
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
					stub.context,
				);
			}, /moves it behind/u);

			// The refusal aborts the transaction: the run order is unchanged.
			assert.deepEqual(members(stub), [first, second]);
			assert.deepEqual(stub.fake.persisted, []);
		} finally {
			cleanupIssueArtifacts(first);
		}
	});

	test("queue sequence appends new work after the dispatched prefix", () => {
		const first = uniqueIssue();
		const second = uniqueIssue();
		const newcomer = uniqueIssue();
		const stub = fakeQueueContext(withSequence([first, second]));
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
				stub.context,
			);

			assert.deepEqual(members(stub), [first, second, newcomer]);
			assert.match(humanText(stub.fake), /Defined sequence/u);
		} finally {
			cleanupIssueArtifacts(first);
			cleanupIssueArtifacts(second);
		}
	});

	test("queue promote refuses a gate whose blocker is still open, naming it", () => {
		const issue = uniqueIssue();
		const blocker = uniqueIssue();
		const stub = fakeQueueContext(
			{
				...emptyQueueManifest(),
				gated: [{ issue, joins: "progression-work", reason: "needs the surface work" }],
			},
			{ live: { issues: { [issue]: { openBlockers: [blocker] } } } },
		);

		assert.throws(
			() => {
				runQueuePromote(parseArgs(["queue", "promote", "--issue", issue]), stub.context);
			},
			new RegExp(`not promotable yet \\(blocked by open #${blocker}\\)`, "u"),
		);

		// A refused gate writes nothing: the gate's recorded reason survives for the next attempt.
		assert.deepEqual(stub.fake.persisted, []);
		assert.equal(stub.current().gated[0]?.reason, "needs the surface work");
	});

	test("queue promote --apply promotes exactly the promotable gates", () => {
		const ready = uniqueIssue();
		const blocked = uniqueIssue();
		const blocker = uniqueIssue();
		const stub = fakeQueueContext(
			{
				...emptyQueueManifest(),
				gated: [
					{ issue: ready, joins: "progression-work", reason: "waiting on the review" },
					{ issue: blocked, joins: "progression-work", reason: `waiting on #${blocker}` },
				],
			},
			{ live: { issues: { [blocked]: { openBlockers: [blocker] }, [ready]: {} } } },
		);

		runQueuePromote(parseArgs(["queue", "promote", "--apply"]), stub.context);

		assert.deepEqual(
			stub.current().sequences,
			[{ issues: [ready], name: "progression-work" }],
			"only the resolved gate moved",
		);
		assert.equal(stub.current().gated.length, 1, "the blocked gate is still gated");
		assert.equal(stub.current().gated[0]?.issue, blocked);
		assert.match(humanText(stub.fake), new RegExp(`Promoted 1 gate\\(s\\): #${ready} → `, "u"));
	});

	test("queue promote --apply with nothing promotable is a no-op the transaction does not write", () => {
		const issue = uniqueIssue();
		const stub = fakeQueueContext(
			{
				...emptyQueueManifest(),
				gated: [{ issue, reason: "needs a decision" }],
			},
			{
				live: {
					issues: { [issue]: { found: false } },
				},
			},
		);

		runQueuePromote(parseArgs(["queue", "promote", "--apply"]), stub.context);

		assert.match(humanText(stub.fake), /Nothing to promote/u);
		assert.deepEqual(
			stub.fake.persisted,
			[],
			"an unchanged manifest is not written, so a clean checkout stays clean",
		);
	});
});

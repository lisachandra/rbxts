/*
 * `queue commands` — the read path and the enabled check, driven through the injected context.
 *
 * These are the behaviors a human or a script depends on and that nothing asserted before: that
 * `queue check` is a usable signal (0 clean, 1 drift, 2 stale gate), that `queue list --json` is
 * machine-parseable with nothing else on the channel, and that a mutation is refused in a repository
 * that disabled the queue while a read is not.
 *
 * The real `computeQueueView` runs over canned live state. That is deliberate: a drift report is the
 * view's classification, so a spec that stubbed the view would only be asserting its own stub. What
 * is faked is the *inputs* — the manifest, GitHub's answer, the gate map — which is exactly the
 * interface production uses.
 */

import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { parseArgs } from "../cli.js";
import { runQueueCommand } from "./commands.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";
import { fakeQueueContext, humanText, problemText, StopSignal } from "./test-helpers.js";

/** A manifest with one batch of open, ready members. */
function cleanManifest(): QueueManifest {
	return {
		...emptyQueueManifest(),
		sequences: [{ issues: ["10", "11"], name: "progression-work" }],
	};
}

/** Runs a command and returns the codes it tried to exit with. */
function exitCodes(manifest: QueueManifest, argv: Array<string>, options = {}): Array<number> {
	const stub = fakeQueueContext(manifest, options);
	assert.throws(
		() => {
			runQueueCommand(parseArgs(argv), stub.context);
		},
		(err: unknown) => err instanceof StopSignal,
	);
	return stub.fake.codes;
}

describe("queue check", () => {
	test("should exit 0 and say so when the manifest has no drift", () => {
		const stub = fakeQueueContext(cleanManifest(), {
			live: {
				issues: { 10: {}, 11: {} },
			},
		});

		runQueueCommand(parseArgs(["queue", "check"]), stub.context);

		assert.deepEqual(stub.fake.codes, [], "a clean check does not exit early");
		assert.match(humanText(stub.fake), /No queue drift/u);
		assert.equal(problemText(stub.fake), "", "nothing is reported as a problem");
	});

	test("should exit 1 when a referenced issue is closed", () => {
		/*
		 * Drift is the view's classification, so the fixture is a real drift case: an issue the manifest
		 * still places but GitHub reports CLOSED. The count in the message is part of the contract — an
		 * operator reads it to know how much work the pass just found.
		 */
		const codes = exitCodes(cleanManifest(), ["queue", "check"], {
			live: { issues: { 10: {}, 11: { state: "CLOSED" } } },
		});

		assert.deepEqual(codes, [1]);
	});

	test("should exit 2 when --strict-gates finds a promotable gate", () => {
		/*
		 * A promotable gate is not drift under the default pass — the queue can still run — so the relaxed
		 * check stays clean and only `--strict-gates` turns it into a failure. That two-pass shape is what
		 * makes exit 2 distinct from exit 1.
		 */
		const codes = exitCodes(
			{
				...emptyQueueManifest(),
				gated: [
					{ issue: "12", joins: "progression-work", reason: "waiting on the review" },
				],
				sequences: [{ issues: ["10"], name: "progression-work" }],
			},
			["queue", "check", "--strict-gates"],
			{ live: { issues: { 10: {}, 12: {} } } },
		);

		assert.deepEqual(codes, [2]);
	});

	test("should report the drift on the problem channel, not the payload channel", () => {
		const stub = fakeQueueContext(cleanManifest(), {
			live: { issues: { 10: {}, 11: { state: "CLOSED" } } },
		});

		assert.throws(() => {
			runQueueCommand(parseArgs(["queue", "check", "--json"]), stub.context);
		}, StopSignal);

		const payload = stub.fake.lines.filter(
			(entry) => entry.channel === "line" && entry.text.startsWith("{"),
		);
		assert.equal(payload.length, 1, "one machine payload, exactly");
		const parsed = JSON.parse(payload[0]?.text ?? "{}") as { drift: Array<string> };
		assert.ok(parsed.drift.length > 0, "the payload carries the drift it exits 1 for");
		assert.match(problemText(stub.fake), /Queue drift/u);
	});
});

describe("queue list", () => {
	test("should print one JSON payload with --json and nothing else", () => {
		const stub = fakeQueueContext(cleanManifest(), { live: { issues: { 10: {}, 11: {} } } });

		runQueueCommand(parseArgs(["queue", "list", "--json"]), stub.context);

		assert.equal(stub.fake.lines.length, 1, "a --json read emits exactly one line");
		const view = JSON.parse(stub.fake.lines[0]?.text ?? "{}") as {
			sequences: Array<{ name: string; status: string }>;
		};
		assert.equal(view.sequences[0]?.name, "progression-work");
		assert.equal(view.sequences[0]?.status, "READY");
	});

	test("should render the human view when --json is absent", () => {
		const stub = fakeQueueContext(cleanManifest(), { live: { issues: { 10: {}, 11: {} } } });

		runQueueCommand(parseArgs(["queue", "list"]), stub.context);

		assert.match(humanText(stub.fake), /progression-work/u);
		assert.equal(
			stub.fake.lines.some((entry) => entry.text.startsWith("{")),
			false,
			"the human rendering is not a JSON payload",
		);
	});

	test("should count a chain break as drift, which the pure view cannot see", () => {
		/*
		 * Chain containment is git and phase state. The fake answers with a break, and `queue check` must
		 * treat it exactly like any other drift — otherwise a batch whose members fell out of run order
		 * would pass a check the dispatcher then ignores.
		 */
		const stub = fakeQueueContext(cleanManifest(), {
			live: { issues: { 10: {}, 11: {} } },
		});
		stub.context.chainDrift = () => ['Chain break in batch "progression-work": b (#11) ...'];

		assert.throws(() => {
			runQueueCommand(parseArgs(["queue", "check"]), stub.context);
		}, StopSignal);
		assert.deepEqual(stub.fake.codes, [1]);
	});
});

describe("the disabled-queue check", () => {
	/** A context whose repository disabled the queue, overridable per invocation. */
	function disabled(manifest: QueueManifest): ReturnType<typeof fakeQueueContext> {
		const stub = fakeQueueContext(manifest, { live: { issues: { 10: {}, 11: {} } } });
		stub.context.enabled = (options) => options.queueEnabled ?? false;
		return stub;
	}

	test("should refuse a mutating subcommand and name the override", () => {
		const stub = disabled(cleanManifest());

		assert.throws(() => {
			runQueueCommand(
				parseArgs(["queue", "add", "--issue", "5", "--sequence", "progression-work"]),
				stub.context,
			);
		}, /Queue workflow is disabled[\s\S]*--queue/u);

		assert.deepEqual(stub.fake.transactions, [], "nothing was read or written");
	});

	test("should let a read subcommand report and return without exiting", () => {
		const stub = disabled(cleanManifest());

		runQueueCommand(parseArgs(["queue", "list"]), stub.context);

		assert.deepEqual(stub.fake.codes, []);
		assert.match(humanText(stub.fake), /Queue workflow disabled/u);
	});

	test("should emit the machine answer under --json for either kind", () => {
		const stub = disabled(cleanManifest());

		runQueueCommand(parseArgs(["queue", "list", "--json"]), stub.context);

		assert.deepEqual(JSON.parse(stub.fake.lines[0]?.text ?? "{}"), {
			enabled: false,
			subcommand: "list",
		});
	});

	test("should still run cancel, because the residue outlives the setting", () => {
		/*
		 * `cancel` is dispatched before the enabled check: a repository that turned the queue off can still
		 * have a lock or a lease from a run that died, and saying "nothing to check" there would leave a
		 * later re-enable blocked.
		 *
		 * `cancel.test.ts` already covers that end to end, including through this entry point, so this spec
		 * asserts only the ordering property that belongs to the command group: the disabled-queue branch
		 * prints through the context, and it must not have printed.
		 */
		const stub = disabled(cleanManifest());

		try {
			runQueueCommand(parseArgs(["queue", "cancel"]), stub.context);
		} catch (err) {
			// A refused live holder exits 1; that is the command's answer, not the disabled-queue refusal.
			assert.ok(err instanceof StopSignal, String(err));
		}

		assert.equal(
			stub.fake.lines.some((entry) => entry.text.includes("Queue workflow disabled")),
			false,
			"the disabled-queue refusal never ran",
		);
	});
});

describe("queue graph", () => {
	/** Two unconstrained batches, which is the fewest that can share a lane. */
	function parallelManifest(): QueueManifest {
		return {
			...emptyQueueManifest(),
			sequences: [
				{ issues: ["10"], name: "A" },
				{ issues: ["11"], name: "B" },
			],
		};
	}

	/** `queue graph --json`'s payload, parsed. */
	function graphPayload(
		manifest: QueueManifest,
		lanes: { parallel: number; profiles: Array<string> },
	): { lanes?: { profiles: Array<string>; ranks: Array<{ batches: Array<string> }> } } {
		const stub = fakeQueueContext(manifest, { lanes, live: { issues: { 10: {}, 11: {} } } });

		runQueueCommand(parseArgs(["queue", "graph", "--json"]), stub.context);

		assert.equal(stub.fake.lines.length, 1, "--json emits exactly one payload");
		return JSON.parse(stub.fake.lines[0]?.text ?? "{}") as ReturnType<typeof graphPayload>;
	}

	test("should draw lanes from the context's parallel setting and profiles", () => {
		const payload = graphPayload(parallelManifest(), {
			parallel: 2,
			profiles: ["sonnet", "flash"],
		});

		assert.deepEqual(payload.lanes?.profiles, ["sonnet", "flash"]);
		assert.deepEqual(payload.lanes?.ranks, [{ batches: ["A", "B"], index: 0 }]);
	});

	test("should carry no lanes when the context reports a serial queue", () => {
		const payload = graphPayload(parallelManifest(), { parallel: 1, profiles: ["sonnet"] });

		assert.equal(payload.lanes, undefined);
	});

	test("should print the lanes in the terminal preview when the queue is parallel", () => {
		const stub = fakeQueueContext(parallelManifest(), {
			lanes: { parallel: 2, profiles: ["sonnet", "flash"] },
			live: { issues: { 10: {}, 11: {} } },
		});

		runQueueCommand(parseArgs(["queue", "graph", "--format", "ascii"]), stub.context);

		const preview = humanText(stub.fake);
		assert.ok(preview.includes("  Parallel lanes:"), preview);
		assert.ok(preview.includes("lane profiles: 1=sonnet 2=flash"), preview);
	});

	test("should put the lanes in the Mermaid diagram, which is the default rendering", () => {
		const stub = fakeQueueContext(parallelManifest(), {
			lanes: { parallel: 2, profiles: ["sonnet", "flash"] },
			live: { issues: { 10: {}, 11: {} } },
		});

		runQueueCommand(parseArgs(["queue", "graph"]), stub.context);

		const mermaid = humanText(stub.fake);
		assert.ok(
			mermaid.includes('subgraph rank_0["rank 1 · A lane 1 sonnet, B lane 2 flash"]'),
			mermaid,
		);
	});
});

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

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
import { runQueueAdd, runQueueRule } from "./ops.js";

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
	test("runQueueAdd refuses an insertion ahead of an already-dispatched member", () => {
		const anchor = uniqueIssue();
		const dispatched = uniqueIssue();
		const newcomer = uniqueIssue();
		const output = stage({
			...emptyQueueManifest(),
			sequences: [{ issues: [anchor, dispatched], name: "progression-work" }],
		});
		writeState(makeState(dispatched));

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
			}, /already been dispatched/u);

			// The refusal aborts the transaction: the manifest on disk is unchanged.
			assert.deepEqual(written().sequences[0]?.issues, [anchor, dispatched]);
		} finally {
			output.done();
			cleanupIssueArtifacts(dispatched);
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
});

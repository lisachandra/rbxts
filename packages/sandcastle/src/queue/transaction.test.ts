/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";

import { parseArgs } from "../cli.js";
import { config } from "../runtime.js";
import { gitStub, registerTestHooks, tmpRoot } from "../test-helpers.js";
import { acquireQueueLock, manifestLockName, queueLockPath } from "./lock.js";
import { emptyQueueManifest, readQueueManifest } from "./manifest.js";
import { transactQueueManifest } from "./persist.js";

registerTestHooks();

const primary = join(tmpRoot, "transaction-primary");
const relativeManifest = "sandcastle.queue.test.json";
const manifestPath = join(primary, relativeManifest);
const lockPath = join(primary, config.dir, manifestLockName);

/** Stubs git so the manifest and the lock resolve against a chosen primary checkout. */
function stubGit(primaryRoot: string, status = " M sandcastle.queue.test.json"): void {
	gitStub({
		file: (args) => {
			if (args[0] === "rev-parse") {
				return join(primaryRoot, ".git");
			}

			if (args[0] === "status") {
				return status;
			}

			return "";
		},
	});
}

/** Runs a transaction that adds one sequence, capturing what it printed. */
function addSequence(issue: string, options = parseArgs(["queue", "list"])): string {
	const lines: Array<string> = [];
	const original = console.log;
	console.log = ((...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	}) as typeof console.log;
	try {
		transactQueueManifest(options, (manifest) => ({
			message: `  ✓ Placed #${issue}`,
			next: {
				...manifest,
				sequences: [...manifest.sequences, { issues: [issue], name: `batch-${issue}` }],
			},
			summary: `place #${issue} in the queue`,
		}));
	} finally {
		console.log = original;
	}

	return lines.join("\n");
}

describe("queue manifest transactions", () => {
	test("writes through the lock and releases it", () => {
		rmSync(manifestPath, { force: true });
		rmSync(lockPath, { force: true });
		stubGit(primary);
		config.queue.file = relativeManifest;
		config.queue.commit = false;

		const output = addSequence("7");

		assert.match(output, /Placed #7/u);
		assert.equal(existsSync(lockPath), false);
		assert.deepEqual(
			readQueueManifest(manifestPath).sequences.map((sequence) => sequence.name),
			["batch-7"],
		);
	});

	test("refuses a held lock instead of losing the first writer's change", () => {
		rmSync(manifestPath, { force: true });
		stubGit(primary);
		config.queue.file = relativeManifest;
		config.queue.commit = false;

		const release = acquireQueueLock({ name: manifestLockName });
		try {
			assert.throws(() => addSequence("8"), /holds .*queue-manifest\.lock/u);
		} finally {
			release();
		}

		// The first writer's manifest is untouched: no read-modify-write happened at all.
		assert.equal(existsSync(manifestPath), false);
	});

	test("steals a stale lock", () => {
		rmSync(manifestPath, { force: true });
		stubGit(primary);
		config.queue.file = relativeManifest;
		config.queue.commit = false;

		writeFileSync(
			queueLockPath(manifestLockName),
			JSON.stringify({ at: Date.now() - 20 * 60 * 1000, host: "dead", pid: 1234 }),
			"utf-8",
		);

		addSequence("9");

		assert.equal(existsSync(lockPath), false);
		assert.equal(readQueueManifest(manifestPath).sequences.length, 1);
	});

	test("a no-op transaction does not rewrite the manifest", () => {
		rmSync(manifestPath, { force: true });
		stubGit(primary);
		config.queue.file = relativeManifest;
		config.queue.commit = false;

		transactQueueManifest(parseArgs(["queue", "list"]), (manifest) => ({
			message: "  ✓ Nothing to prune",
			next: manifest,
			summary: "prune closed issues",
		}));

		assert.equal(existsSync(manifestPath), false);
	});

	test("leaves no temporary file behind", () => {
		rmSync(manifestPath, { force: true });
		stubGit(primary);
		config.queue.file = relativeManifest;
		config.queue.commit = false;

		addSequence("10");

		const leftovers = readdirSync(dirname(manifestPath)).filter((entry) =>
			entry.includes(".tmp-"),
		);
		assert.deepEqual(leftovers, []);
	});

	test("dry run reports the intended change without writing", () => {
		rmSync(manifestPath, { force: true });
		stubGit(primary);
		config.queue.file = relativeManifest;
		config.queue.commit = false;

		const output = addSequence("11", {
			...parseArgs(["queue", "list"]),
			dryRun: true,
		});

		assert.match(output, /dry run/u);
		assert.match(output, /Placed #11/u);
		assert.equal(existsSync(manifestPath), false);
		assert.deepEqual(emptyQueueManifest().sequences, []);
	});
});

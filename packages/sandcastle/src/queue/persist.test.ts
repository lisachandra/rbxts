/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { parseArgs } from "../cli.js";
import { primaryRepoRoot } from "../git.js";
import { config } from "../runtime.js";
import { gitStub, registerTestHooks, repositoryRoot, tmpRoot } from "../test-helpers.js";
import { emptyQueueManifest, readQueueManifest } from "./manifest.js";
import { queueCommitEnabled, transactQueueManifest } from "./persist.js";

registerTestHooks();

const relativeManifest = ".tmp/sandcastle-tests/queue-persist.json";
const manifestPath = join(repositoryRoot, relativeManifest);
/** A primary checkout other than this worktree, so the location notice is exercised. */
const otherPrimary = join(tmpRoot, "primary-checkout");
const otherManifestPath = join(otherPrimary, relativeManifest);

interface GitCall {
	args: Array<string>;
	cwd: string | undefined;
}

/** Stubs git so the manifest resolves against a chosen primary checkout. */
function stubGit(
	calls: Array<GitCall>,
	primary: string,
	status = " M sandcastle.queue.json",
): void {
	gitStub({
		file: (args, cwd) => {
			calls.push({ args: [...args], cwd });
			if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) {
				return "main";
			}

			if (args[0] === "rev-parse") {
				return join(primary, ".git");
			}

			if (args[0] === "status") {
				return status;
			}

			return "";
		},
	});
}

function quiet(run: () => void): string {
	const lines: Array<string> = [];
	const original = console.log;
	console.log = ((...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	}) as typeof console.log;

	try {
		run();
	} finally {
		console.log = original;
	}

	return lines.join("\n");
}

describe("queue manifest persistence", () => {
	test("a dry run never writes and says so", () => {
		rmSync(manifestPath, { force: true });
		const calls: Array<GitCall> = [];
		stubGit(calls, repositoryRoot);
		config.queue.file = relativeManifest;

		const output = quiet(() => {
			transactQueueManifest({ ...parseArgs(["queue", "list"]), dryRun: true }, () => ({
				next: emptyQueueManifest(),
				summary: "test",
			}));
		});

		assert.match(output, /dry run/u);
		assert.equal(existsSync(manifestPath), false);
	});

	test("writes the manifest in the primary checkout and reports the location", () => {
		rmSync(otherManifestPath, { force: true });
		const calls: Array<GitCall> = [];
		stubGit(calls, otherPrimary);
		config.queue.file = relativeManifest;
		config.queue.commit = false;

		const output = quiet(() => {
			transactQueueManifest(parseArgs(["queue", "list"]), () => ({
				next: emptyQueueManifest(),
				summary: "test",
			}));
		});

		assert.equal(existsSync(otherManifestPath), true);
		assert.deepEqual(readQueueManifest(otherManifestPath).sequences, []);
		assert.match(output, /↳ Manifest: /u);
		assert.equal(
			calls.some((call) => call.args[0] === "commit"),
			false,
		);
	});

	test("commits only the manifest, from the primary checkout, when the queue opts in", () => {
		rmSync(manifestPath, { force: true });
		const calls: Array<GitCall> = [];
		stubGit(calls, repositoryRoot);
		config.queue.file = relativeManifest;
		config.queue.commit = true;

		quiet(() => {
			transactQueueManifest(parseArgs(["queue", "list"]), () => ({
				next: emptyQueueManifest(),
				summary: "place #1",
			}));
		});

		const commit = calls.find((call) => call.args[0] === "commit");
		assert.ok(commit !== undefined);
		assert.equal(commit.cwd, primaryRepoRoot());
		assert.match(commit.args.join(" "), /^commit -m chore\(queue\): place #1 -- /u);
		assert.equal(
			calls.some((call) => call.args[0] === "add"),
			true,
		);
	});

	test("skips the commit when the manifest is already clean", () => {
		rmSync(manifestPath, { force: true });
		const calls: Array<GitCall> = [];
		stubGit(calls, repositoryRoot, "");
		config.queue.file = relativeManifest;
		config.queue.commit = true;

		quiet(() => {
			transactQueueManifest(parseArgs(["queue", "list"]), () => ({
				next: emptyQueueManifest(),
				summary: "place #1",
			}));
		});

		assert.equal(
			calls.some((call) => call.args[0] === "commit"),
			false,
		);
	});

	test("--queue-commit overrides a repository that does not commit", () => {
		config.queue.commit = false;

		assert.equal(
			queueCommitEnabled({ ...parseArgs(["queue", "list"]), queueCommit: true }),
			true,
		);
		assert.equal(queueCommitEnabled(parseArgs(["queue", "list"])), false);
	});
});

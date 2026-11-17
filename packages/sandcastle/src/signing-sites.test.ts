/*
 * The three automated commit sites, asserted from the git argv each one produces.
 *
 * The property under test is not "a helper was called" but "this site signs when the host requires it
 * and verifies what it created". A stub `git` records every call, so a site that stopped threading the
 * policy shows up as a missing `--gpg-sign` rather than as a passing unit test of the helper.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, test } from "vitest";

import { assertCleanMergeResolution, type MergerDeps } from "./integration/merger.js";
import { commitPlan } from "./issue.js";
import { commitQueueManifest } from "./queue/persist.js";
import { config } from "./runtime.js";
import { UnsignedCommitError } from "./signing.js";
import { gitStub, registerTestHooks, tmpRoot } from "./test-helpers.js";
import type { IntegrationManifest } from "./types.js";

registerTestHooks();

const createdDirs: Array<string> = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

interface RecordedGit {
	args: ReadonlyArray<string>;
	cwd: string | undefined;
}

/**
 * A stub git that answers the questions the commit sites ask — the signing policy, the signature
 * status, the current branch, and whether the manifest is dirty — and records everything else.
 */
function stubGit(options: { requiresSignature: boolean; status?: string }): Array<RecordedGit> {
	const calls: Array<RecordedGit> = [];
	gitStub({
		file: (args, cwd) => {
			calls.push({ args, cwd });
			if (args[0] === "config" && args.includes("commit.gpgsign")) {
				return options.requiresSignature ? "true" : "false";
			}

			if (args[0] === "log" && args.includes("--format=%G?")) {
				return options.status ?? (options.requiresSignature ? "G" : "N");
			}

			/*
			 * `commitQueueManifest` refuses to commit off its configured branch, and skips when the
			 * manifest is already clean. Both answers have to be the ones that let the site run, or the
			 * spec would pass by never reaching the commit it claims to test.
			 */
			if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) {
				return config.queue.commitBranch;
			}

			if (args[0] === "status" && args.includes("--porcelain")) {
				return ` M ${join(config.dir, "queue.json")}`;
			}

			return "";
		},
	});
	return calls;
}

/** A worktree directory holding a committed plan, with `git` stubbed. */
function planWorktree(issueNumber: string): string {
	const worktree = join(tmpRoot, "signing-sites", `issue-${issueNumber}`);
	mkdirSync(join(worktree, config.dir, "plans"), { recursive: true });
	writeFileSync(join(worktree, config.dir, "plans", `${issueNumber}.md`), "# Plan", "utf-8");
	createdDirs.push(worktree);
	return worktree;
}

describe("the plan commit site", () => {
	test("should sign and verify when the host requires signatures", () => {
		const calls = stubGit({ requiresSignature: true });
		const worktree = planWorktree("701");

		commitPlan(worktree, "701");

		const commit = calls.find((call) => call.args[0] === "commit");
		assert.ok(commit !== undefined, "the plan was committed");
		assert.ok(commit.args.includes("--gpg-sign"), "signing was asked for on the argv");
		assert.ok(
			calls.some((call) => call.args[0] === "log" && call.args.includes("--format=%G?")),
			"and the result was verified",
		);
	});

	test("should neither sign nor verify when the host does not require it", () => {
		// The throwaway-repository case the suite depends on.
		const calls = stubGit({ requiresSignature: false });
		const worktree = planWorktree("702");

		commitPlan(worktree, "702");

		const commit = calls.find((call) => call.args[0] === "commit");
		assert.ok(commit !== undefined);
		assert.equal(commit.args.includes("--gpg-sign"), false);
		assert.equal(
			calls.some((call) => call.args[0] === "log" && call.args.includes("--format=%G?")),
			false,
			"a repository with signing off never reaches the verification",
		);
	});

	test("should rethrow an unsigned commit instead of warning and continuing", () => {
		/*
		 * Every other failure at this site is best-effort: the operator can commit the plan by hand.
		 * An unsigned commit is not — it exists, and it is missing what the host policy requires, which
		 * is precisely the state that cost a history rewrite.
		 */
		stubGit({ requiresSignature: true, status: "N" });
		const worktree = planWorktree("703");

		assert.throws(
			() => {
				commitPlan(worktree, "703");
			},
			(error: Error) => {
				assert.ok(error instanceof UnsignedCommitError);

				return true;
			},
		);
	});
});

describe("the queue manifest commit site", () => {
	test("should sign and verify the manifest commit when signatures are required", () => {
		const calls = stubGit({ requiresSignature: true });

		commitQueueManifest("place #704 in the queue", {
			queueCommitAny: true,
		} as Parameters<typeof commitQueueManifest>[1]);

		const commit = calls.find((call) => call.args[0] === "commit");
		assert.ok(commit !== undefined, "the manifest was committed");
		assert.ok(commit.args.includes("--gpg-sign"));
		assert.ok(
			calls.some((call) => call.args[0] === "log" && call.args.includes("--format=%G?")),
			"and the created commit was verified",
		);
	});

	test("should rethrow an unsigned manifest commit", () => {
		stubGit({ requiresSignature: true, status: "N" });

		assert.throws(() => {
			commitQueueManifest("place #705 in the queue", {
				queueCommitAny: true,
			} as Parameters<typeof commitQueueManifest>[1]);
		}, UnsignedCommitError);
	});
});

describe("the integration merge commit site", () => {
	function mergeDeps(options: { requiresSignature: boolean; status?: string }): {
		calls: Array<Array<string>>;
		deps: Partial<MergerDeps>;
	} {
		const calls: Array<Array<string>> = [];
		return {
			calls,
			deps: {
				assertCommitSigned: (subject, policy, cwd) => {
					// Defer to the real check, so the site is tested rather than a stub of it.
					const status = options.status ?? (options.requiresSignature ? "G" : "N");
					if (policy.required && status !== "G" && status !== "U") {
						throw new UnsignedCommitError(`Commit ${subject} is unsigned (${cwd}).`);
					}
				},
				git: (args) => {
					calls.push([...args]);
					return "";
				},
				hasUnmergedPaths: () => false,
				mergeInProgress: () => true,
				readCommitSigningPolicy: () => ({
					required: options.requiresSignature,
					source: options.requiresSignature
						? "commit.gpgsign=true"
						: "commit.gpgsign=false",
				}),
			},
		};
	}

	function manifest(): IntegrationManifest {
		return {
			base: { commit: "1111111", ref: "main" },
			branch: "sandcastle/integration/signing-706",
			createdAt: "2026-01-01T00:00:00.000Z",
			kind: "issues",
			name: "signing-706",
			sources: [],
			status: "merging",
			updatedAt: "2026-01-01T00:00:00.000Z",
			worktree: ".sandcastle/integrations/signing-706/signing-706",
		};
	}

	test("should sign the commit that finishes a conflicted merge", () => {
		const { calls, deps } = mergeDeps({ requiresSignature: true });

		assertCleanMergeResolution(manifest(), deps);

		const commit = calls.find((args) => args[0] === "commit");
		assert.ok(commit !== undefined, "the merge was committed");
		assert.ok(commit.includes("--gpg-sign"));
	});

	test("should not sign when the host does not require it", () => {
		const { calls, deps } = mergeDeps({ requiresSignature: false });

		assertCleanMergeResolution(manifest(), deps);

		const commit = calls.find((args) => args[0] === "commit");
		assert.ok(commit !== undefined);
		assert.equal(commit.includes("--gpg-sign"), false);
	});

	test("should refuse a conflicted merge that came out unsigned", () => {
		const { deps } = mergeDeps({ requiresSignature: true, status: "N" });

		assert.throws(() => {
			assertCleanMergeResolution(manifest(), deps);
		}, UnsignedCommitError);
	});
});

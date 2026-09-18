/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { gitStub, integrationsDir, registerTestHooks } from "../test-helpers.js";
import type { IntegrationManifest } from "../types.js";
import type { SetupWorktreeOptions } from "../worktree.js";
import { continueIntegration, prepareIntegrationWorktree } from "./orchestrator.js";

registerTestHooks();

function makeManifest(name: string): IntegrationManifest {
	return {
		base: { commit: "1111111", ref: "main" },
		branch: `sandcastle/integration/${name}`,
		createdAt: new Date().toISOString(),
		kind: "issues",
		name,
		sources: [
			{
				branch: "sandcastle/issue-1",
				commit: "2222222",
				issue: "1",
				name: "issue-1",
				order: 1,
			},
		],
		status: "merging",
		updatedAt: new Date().toISOString(),
		worktree: `.sandcastle/integrations/${name}/worktree`,
	};
}

describe("orchestrator worktree setup seam", () => {
	test("should prepare integration worktree using shared setupWorktree", () => {
		const worktree = "/tmp/integration-worktree";
		let capturedWorktree: string | undefined;
		let capturedOptions: undefined | SetupWorktreeOptions;

		const preparer = (path: string, options: SetupWorktreeOptions): void => {
			capturedWorktree = path;
			capturedOptions = options;
		};

		// Default options → ignoreSetup/skipSetup false.
		prepareIntegrationWorktree(worktree, false, false, preparer);
		assert.equal(capturedWorktree, worktree);
		assert.deepEqual(capturedOptions, { ignoreSetup: false, skipSetup: false });

		// Options forwarded exactly.
		prepareIntegrationWorktree(worktree, true, true, preparer);
		assert.deepEqual(capturedOptions, { ignoreSetup: true, skipSetup: true });

		// If no preparer is injected it defaults to the shared setupWorktree (compile-time only).
		assert.equal(typeof prepareIntegrationWorktree, "function");
	});
});

describe("orchestrator state machine", () => {
	test("continueIntegration runs merging, review, and ready-for-human-merge", async () => {
		const name = `orchestrate-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = makeManifest(name);

		let prepared = 0;
		let reviewRan = false;
		let conflictResolverRan = false;

		gitStub({
			file: (args) => {
				if (args[0] === "merge-base") {
					// Source commit is already an ancestor → merge short-circuits.
					return "";
				}

				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "abcdef1234567";
				}

				if (args[0] === "status") {
					return "";
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				return "";
			},
		});

		const deps = {
			prepareWorktree: (w: string, ignoreSetup: boolean, skipSetup: boolean) => {
				prepared += 1;
				assert.equal(w, worktree);
				assert.equal(ignoreSetup, false);
				assert.equal(skipSetup, false);
			},
			runConflictResolver: async () => {
				conflictResolverRan = true;
			},
			runIntegrationReview: async () => {
				reviewRan = true;
			},
		};

		await continueIntegration(
			manifest,
			"m",
			"low",
			"dirac",
			false,
			false,
			undefined,
			false,
			deps,
		);

		assert.equal(prepared, 1);
		assert.equal(conflictResolverRan, false);
		assert.equal(reviewRan, true);
		assert.equal(manifest.status, "ready-for-human-merge");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("continueIntegration fails fast when the worktree is missing", async () => {
		const name = `orchestrate-missing-${Date.now()}`;
		const manifest = makeManifest(name);

		await assert.rejects(
			async () => continueIntegration(manifest, "m", "low", "dirac", false, false),
			/Integration worktree is missing/,
		);

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});
});

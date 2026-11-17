import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

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

		const preparer = (path: string, options: SetupWorktreeOptions): string | undefined => {
			capturedWorktree = path;
			capturedOptions = options;
			return undefined;
		};

		// Default options → ignoreSetup/skipSetup false, agent default output "log".
		prepareIntegrationWorktree(worktree, false, false, undefined, preparer);
		assert.equal(capturedWorktree, worktree);
		assert.deepEqual(capturedOptions, {
			ignoreSetup: false,
			logKind: "integration",
			output: "log",
			skipSetup: false,
		});

		// Options forwarded exactly.
		prepareIntegrationWorktree(worktree, true, true, "inherit", preparer);
		assert.deepEqual(capturedOptions, {
			ignoreSetup: true,
			logKind: "integration",
			output: "inherit",
			skipSetup: true,
		});

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
				return undefined;
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

	test("continueIntegration quarantines review drift instead of failing the hand-off", async () => {
		/*
		 * The review agent leaves edits behind; failing the hand-off for them is what left an
		 * integration aborted with no pull request. With drift tolerance on (what landing now always
		 * passes) they are stashed and recorded, and the composition still reaches its hand-off state.
		 */
		const name = `orchestrate-drift-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = makeManifest(name);

		let stashed = false;
		const stashCommands: Array<Array<string>> = [];

		gitStub({
			file: (args) => {
				if (args[0] === "status") {
					// Dirty until the quarantine stashes it, clean afterwards.
					return stashed ? "" : " M src/a.ts";
				}

				if (args[0] === "stash") {
					stashCommands.push([...args]);
					stashed = true;
					return "";
				}

				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "deadbeef1234";
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				return "";
			},
		});

		await continueIntegration(manifest, "m", "low", "dirac", false, false, undefined, true, {
			prepareWorktree: () => undefined,
			runConflictResolver: async () => undefined,
			runIntegrationReview: async () => undefined,
		});

		assert.equal(stashCommands.length, 1, "the drift was stashed rather than fatal");
		assert.equal(manifest.status, "ready-for-human-merge", "the hand-off still completed");
		assert.deepEqual(manifest.drift?.paths, ["src/a.ts"]);
		assert.equal(manifest.drift?.stashCommit, "deadbeef1234");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("post-review drift is quarantined even when the pre-merge tolerance is off", async () => {
		/*
		 * The review agent churns the worktree by construction, so a hand-off that refuses it can
		 * never finish: the retry re-runs the review and fails on the same surviving file. The
		 * `quarantineDrift` flag keeps its meaning for the pre-merge phase, where the dirt may be a
		 * human's in-flight work, and no longer decides whether a finished review may be handed off.
		 */
		const name = `orchestrate-strict-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = makeManifest(name);

		let stashed = false;
		const stashCommands: Array<Array<string>> = [];
		gitStub({
			file: (args) => {
				if (args[0] === "status") {
					return stashed ? "" : " M src/a.ts";
				}

				if (args[0] === "stash") {
					stashCommands.push([...args]);
					stashed = true;
					return "";
				}

				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "deadbeef1234";
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				return "";
			},
		});

		await continueIntegration(manifest, "m", "low", "dirac", false, false, undefined, false, {
			prepareWorktree: () => undefined,
			runConflictResolver: async () => undefined,
			runIntegrationReview: async () => undefined,
		});

		assert.equal(stashCommands.length, 1, "the drift was stashed rather than fatal");
		assert.deepEqual(manifest.drift?.paths, ["src/a.ts"]);
		assert.equal(manifest.status, "ready-for-human-merge");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("hand-off ignores submodule content dirt and untracked paths", async () => {
		/*
		 * The exact shape that failed a resume forever: `pnpm setup` runs `pnpm install` inside
		 * `submodules/nexus-sync`, which leaves a lockfile that submodule does not ignore. The
		 * recorded pointer is unchanged, so the branch carries nothing — and a fresh worktree's
		 * build output is untracked anyway.
		 */
		const name = `orchestrate-noise-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = makeManifest(name);

		let stashed = false;
		gitStub({
			file: (args) => {
				if (args[0] === "status") {
					return " M submodules/nexus-sync";
				}

				if (args[0] === "stash") {
					stashed = true;
					return "";
				}

				if (args[0] === "ls-files" && args[1] === "--stage") {
					return "160000 49b76f2 0\tsubmodules/nexus-sync";
				}

				if (args[0] === "ls-files" && args[1] === "--others") {
					return "pnpm-lock.yaml";
				}

				if (args[0] === "-C") {
					return "49b76f2";
				}

				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "deadbeef1234";
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				return "";
			},
		});

		await continueIntegration(manifest, "m", "low", "dirac", false, false, undefined, true, {
			prepareWorktree: () => undefined,
			runConflictResolver: async () => undefined,
			runIntegrationReview: async () => undefined,
		});

		assert.equal(stashed, false, "a branch-invisible difference must not be stashed");
		assert.equal(manifest.status, "ready-for-human-merge");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("a moved submodule pointer blocks the hand-off", async () => {
		/* Content dirt is noise; pointing the branch at a different submodule commit is not. */
		const name = `orchestrate-pointer-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = makeManifest(name);

		gitStub({
			file: (args) => {
				if (args[0] === "status") {
					return " M submodules/nexus-sync";
				}

				if (args[0] === "ls-files" && args[1] === "--stage") {
					return "160000 49b76f2 0\tsubmodules/nexus-sync";
				}

				if (args[0] === "-C") {
					return "aaaaaaa";
				}

				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "deadbeef1234";
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				return "";
			},
		});

		await assert.rejects(
			async () =>
				continueIntegration(manifest, "m", "low", "dirac", false, false, undefined, true, {
					prepareWorktree: () => undefined,
					runConflictResolver: async () => undefined,
					runIntegrationReview: async () => undefined,
				}),
			/Could not quarantine every uncommitted change/,
		);

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("a resume skips the review when the branch tip is unchanged", async () => {
		/* The review's corrections are committed; re-running it reaches the same commit for a full budget. */
		const name = `orchestrate-reviewed-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = makeManifest(name);
		manifest.reviewHead = "deadbeef1234";

		let reviewRan = false;
		gitStub({
			file: (args) => {
				if (args[0] === "status") {
					return "";
				}

				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "deadbeef1234";
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				return "";
			},
		});

		await continueIntegration(manifest, "m", "low", "dirac", false, false, undefined, true, {
			prepareWorktree: () => undefined,
			runConflictResolver: async () => undefined,
			runIntegrationReview: async () => {
				reviewRan = true;
			},
		});

		assert.equal(reviewRan, false, "the approved tip must not be reviewed twice");
		assert.equal(manifest.status, "ready-for-human-merge");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("a completed review stamps the tip so the next resume can skip it", async () => {
		const name = `orchestrate-stamp-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = makeManifest(name);

		gitStub({
			file: (args) => {
				if (args[0] === "status") {
					return "";
				}

				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "deadbeef1234";
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				return "";
			},
		});

		await continueIntegration(manifest, "m", "low", "dirac", false, false, undefined, true, {
			prepareWorktree: () => undefined,
			runConflictResolver: async () => undefined,
			runIntegrationReview: async () => undefined,
		});

		assert.equal(manifest.reviewHead, "deadbeef1234");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});
});

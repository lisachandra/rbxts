/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";

import { integrationsDir } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";
import type { IntegrationManifest } from "../types.js";
import { integrationBasePath, integrationBranch } from "./manifest.js";
import {
	assertCleanMergeResolution,
	integrateManifestSource,
	type MergerDeps,
	prepareWorktreeForMerge,
	quarantineWorktreeDrift,
} from "./merger.js";

registerTestHooks();

function manifestFor(name: string): IntegrationManifest {
	return {
		base: { commit: "1111111", ref: "main" },
		branch: integrationBranch(name),
		createdAt: "2026-01-01T00:00:00.000Z",
		kind: "issues",
		name,
		sources: [],
		status: "merging",
		updatedAt: "2026-01-01T00:00:00.000Z",
		worktree: integrationBasePath({ name } as IntegrationManifest),
	};
}

/** Record git calls while deferring to optional overrides for each merged helper. */
function fakeDeps(
	overrides: Partial<
		Pick<
			MergerDeps,
			| "git"
			| "gitTry"
			| "isGitlink"
			| "dirtyPaths"
			| "mergeInProgress"
			| "hasUnmergedPaths"
			| "changedSinceMergeBase"
		>
	> = {},
): { deps: MergerDeps; gitCalls: Array<{ args: ReadonlyArray<string>; cwd?: string }> } {
	const gitCalls: Array<{ args: ReadonlyArray<string>; cwd?: string }> = [];
	const deps: MergerDeps = {
		changedSinceMergeBase: () => [],
		dirtyPaths: () => [],
		git: (args, cwd) => {
			gitCalls.push({ args: [...args], cwd });
			return overrides.git?.(args, cwd) ?? "";
		},
		gitTry: () => undefined,
		hasUnmergedPaths: () => false,
		isGitlink: () => false,
		mergeInProgress: () => false,
	};

	const merged: MergerDeps = {
		...deps,
		...overrides,
		git: (args, cwd) => {
			gitCalls.push({ args: [...args], cwd });
			return overrides.git?.(args, cwd) ?? "";
		},
	};

	return { deps: merged, gitCalls };
}

describe("merger adapter seam", () => {
	test("should verify clean merge resolution and commit when merge is in progress", () => {
		const manifest = manifestFor("wave-1");
		const worktree = integrationBasePath(manifest);
		assert.equal(worktree, join(integrationsDir, "wave-1", "worktree"));

		// Clean: no unmerged paths, no merge in progress → no git calls.
		const clean = fakeDeps();
		assert.doesNotThrow(() => assertCleanMergeResolution(manifest, clean.deps));
		assert.equal(clean.gitCalls.length, 0);

		// Unmerged paths remain → throw.
		const unmerged = fakeDeps({ hasUnmergedPaths: () => true });
		assert.throws(
			() => assertCleanMergeResolution(manifest, unmerged.deps),
			/unmerged paths remain in .*wave-1[\s\S]*resolve every conflict/i,
		);
		assert.equal(unmerged.gitCalls.length, 0);

		// Merge in progress → auto-commit --no-edit in the worktree.
		const committing = fakeDeps({ mergeInProgress: () => true });
		assert.doesNotThrow(() => assertCleanMergeResolution(manifest, committing.deps));
		assert.deepEqual(committing.gitCalls, [{ args: ["commit", "--no-edit"], cwd: worktree }]);
	});

	test("should quarantine uncommitted drift or abort if drift overlaps incoming merge", () => {
		const manifest = manifestFor("drift");
		const worktree = integrationBasePath(manifest);
		const source = {
			branch: "sandcastle/issue-1",
			commit: "2222222",
			issue: "1",
			name: "issue-1",
			order: 1,
		};

		// No blocking drift → no stash, return.
		const clean = fakeDeps({ dirtyPaths: () => [] });
		let prepared = false;
		assert.doesNotThrow(() => {
			prepareWorktreeForMerge(manifest, source, worktree, false, clean.deps);
			prepared = true;
		});
		assert.equal(prepared, true);
		assert.equal(clean.gitCalls.length, 0);

		// Overlapping drift without quarantine → throw with actionable message.
		const overlap = fakeDeps({
			changedSinceMergeBase: () => ["AGENTS.md", "other.ts"],
			dirtyPaths: () => ["AGENTS.md"],
		});
		assert.throws(
			() => prepareWorktreeForMerge(manifest, source, worktree, false, overlap.deps),
			/uncommitted changes that merging issue-1 would overwrite[\s\S]*--quarantine-drift/,
		);

		// Submodule pointers are reported but never block.
		const submodule = fakeDeps({
			changedSinceMergeBase: () => ["sub"] as Array<string>,
			dirtyPaths: () => ["sub"] as Array<string>,
			isGitlink: () => true,
		});
		assert.doesNotThrow(() =>
			prepareWorktreeForMerge(manifest, source, worktree, false, submodule.deps),
		);

		// Quarantine stashes the blocking paths and records drift on the manifest.
		const stashes: Array<Array<string>> = [];
		let wroteManifest: undefined | IntegrationManifest;
		const quarantine = fakeDeps({
			dirtyPaths: () => [],
			git: (args) => {
				if (args[0] === "stash") {
					stashes.push([...args]);
					return "";
				}

				return "";
			},
		});
		quarantine.deps.gitTry = () => "deadbeef";
		quarantineWorktreeDrift(
			manifest,
			worktree,
			["AGENTS.md"],
			quarantine.deps,
			(written: IntegrationManifest) => {
				wroteManifest = written;
			},
		);
		assert.equal(stashes.length, 1);
		assert.ok(stashes[0]?.includes("AGENTS.md"));
		assert.equal(manifest.drift?.paths[0], "AGENTS.md");
		assert.equal(manifest.drift?.stashCommit, "deadbeef");
		assert.equal(wroteManifest?.name, "drift");
	});

	test("should merge source with no-ff and invoke conflict resolver on unmerged paths", async () => {
		const manifest = manifestFor("merge-conflict");
		const worktree = integrationBasePath(manifest);
		const source = {
			branch: "sandcastle/issue-1",
			commit: "2222222",
			issue: "1",
			name: "issue-1",
			order: 1,
		};

		// Already an ancestor → short-circuit, no git merge.
		const ancestor = fakeDeps({
			gitTry: () => "",
		});
		let resolverRuns = 0;
		await integrateManifestSource(
			manifest,
			source,
			worktree,
			"m",
			"low",
			"dirac",
			undefined,
			false,
			{
				...ancestor.deps,
				runConflictResolver: async () => {
					resolverRuns += 1;
				},
			},
		);
		assert.equal(resolverRuns, 0);
		assert.equal(ancestor.gitCalls.filter((call) => call.args[0] === "merge").length, 0);

		// Non-ancestor, merge succeeds cleanly.
		const merges: Array<Array<string>> = [];
		const merged = fakeDeps({
			dirtyPaths: () => [],
			git: (args) => {
				if (args[0] === "merge") {
					merges.push([...args]);
					return "";
				}

				return "";
			},
			gitTry: () => undefined,
			mergeInProgress: () => false,
		});
		resolverRuns = 0;
		await integrateManifestSource(
			manifest,
			source,
			worktree,
			"m",
			"low",
			"dirac",
			undefined,
			false,
			merged.deps as never,
		);
		assert.equal(merges.length, 1);
		assert.ok(merges[0]?.[0] === "merge" && merges[0].includes("--no-ff"));
		assert.equal(resolverRuns, 0);

		// Merge fails with unmerged paths → invoke resolver, then assert clean resolution.
		let resolverAfterFailure = 0;
		let conflicted = true;
		let mergedCount = 0;
		const conflict = fakeDeps({
			dirtyPaths: () => [],
			git: (args) => {
				if (args[0] === "merge") {
					mergedCount += 1;
					throw new Error("conflict");
				}

				return "";
			},
			gitTry: () => undefined,
			hasUnmergedPaths: () => conflicted,
			mergeInProgress: () => false,
		});
		await integrateManifestSource(
			manifest,
			source,
			worktree,
			"m",
			"low",
			"dirac",
			undefined,
			false,
			{
				...conflict.deps,
				runConflictResolver: async () => {
					resolverAfterFailure += 1;
					// The resolver cleans the unmerged paths so the clean-resolution check passes.
					conflicted = false;
				},
			},
		);
		assert.equal(mergedCount, 1);
		assert.equal(resolverAfterFailure, 1);
		assert.equal(manifest.status, "conflict-resolution-required");
	});
});

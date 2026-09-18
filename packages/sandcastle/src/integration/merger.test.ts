/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";

import { integrationsDir } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";
import type { IntegrationManifest } from "../types.js";
import { integrationBasePath, integrationBranch } from "./manifest.js";
import { assertCleanMergeResolution, type MergerDeps } from "./merger.js";

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
	overrides: Partial<Pick<MergerDeps, "git" | "mergeInProgress" | "hasUnmergedPaths">> = {},
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
});

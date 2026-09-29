/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import type { IntegrationManifest } from "../types.js";
import { sequenceGateNames, unmetIntegrationGates } from "./gates.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";

registerTestHooks();

function manifest(overrides: Partial<QueueManifest> = {}): QueueManifest {
	return {
		...emptyQueueManifest(),
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function integration(overrides: Partial<IntegrationManifest> = {}): IntegrationManifest {
	return {
		base: { commit: "abc", ref: "main" },
		branch: "sandcastle/integration/vfx-surface-work",
		createdAt: "2026-01-01T00:00:00.000Z",
		headCommit: "head",
		kind: "issues",
		name: "vfx-surface-work",
		sources: [],
		status: "ready-for-human-merge",
		updatedAt: "2026-01-01T00:00:00.000Z",
		worktree: "tmp/worktree",
		...overrides,
	};
}

describe("queue run-order gates", () => {
	test("sequenceGateNames collects every after target once", () => {
		const names = sequenceGateNames(
			manifest({
				sequences: [
					{ after: "audio-seam-work", issues: ["1"], name: "V" },
					{ after: "audio-seam-work", issues: ["2"], name: "V2" },
					{ issues: ["3"], name: "N2" },
				],
			}),
		);

		assert.deepEqual([...names], ["audio-seam-work"]);
	});

	test("a gate whose integration was never composed is unmet", () => {
		const unmet = unmetIntegrationGates({
			baseBranch: "main",
			names: ["vfx-surface-work"],
			readManifest: () => undefined,
		});

		assert.match(unmet.get("vfx-surface-work") ?? "", /has not been composed yet/u);
	});

	test("a composition that never finished stays unmet", () => {
		const unmet = unmetIntegrationGates({
			baseBranch: "main",
			isAncestor: () => true,
			names: ["vfx-surface-work"],
			readManifest: () => integration({ status: "merging" }),
		});

		assert.match(unmet.get("vfx-surface-work") ?? "", /composition status is merging/u);
	});

	test("a composed integration that has not landed on the base branch is unmet", () => {
		const unmet = unmetIntegrationGates({
			baseBranch: "main",
			isAncestor: () => false,
			names: ["vfx-surface-work"],
			readManifest: () => integration(),
		});

		assert.match(unmet.get("vfx-surface-work") ?? "", /to land on main/u);
	});

	test("a landed integration is absent from the gate map", () => {
		const unmet = unmetIntegrationGates({
			baseBranch: "main",
			isAncestor: (commit, ref) => commit === "head" && ref === "main",
			names: ["vfx-surface-work"],
			readManifest: () => integration(),
		});

		assert.deepEqual([...unmet], [], "a landed gate must not block dispatch");
	});
});

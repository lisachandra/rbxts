/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";

import { integrationsDir } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";
import type { IntegrationManifest } from "../types.js";
import {
	assertIntegrationName,
	createIntegrationManifest,
	integrationBasePath,
	integrationBranch,
	integrationManifestPath,
	type ManifestFs,
	readIntegrationManifest,
	writeIntegrationManifest,
} from "./manifest.js";

registerTestHooks();

/** In-memory ManifestFs so manifest I/O is exercised without touching the real filesystem. */
function memoryFs(): {
	fs: ManifestFs;
	read: (path: string) => string | undefined;
} {
	const files = new Map<string, string>();
	return {
		fs: {
			existsSync: (path) => files.has(path),
			mkdirSync: () => undefined,
			readFileSync: (path, encoding) => {
				// Guard against unused-encoding style nits while preserving the interface.
				void encoding;
				const value = files.get(path);
				if (value === undefined) {
					throw new Error(`ENOENT: no such file ${path}`);
				}

				return value;
			},
			writeFileSync: (path, data) => {
				files.set(path, data);
			},
		},
		read: (path) => files.get(path),
	};
}

function manifestFor(
	name: string,
	overrides: Partial<IntegrationManifest> = {},
): IntegrationManifest {
	return {
		base: { commit: "abc1234", ref: "main" },
		branch: integrationBranch(name),
		createdAt: "2026-01-01T00:00:00.000Z",
		kind: "issues",
		name,
		sources: [],
		status: "created",
		updatedAt: "2026-01-01T00:00:00.000Z",
		worktree: integrationBasePath({ name } as IntegrationManifest),
		...overrides,
	};
}

describe("integration manifest seam", () => {
	test("should read, write, and validate integration manifests with dependency injection", () => {
		assert.equal(integrationBranch("wave-1"), "sandcastle/integration/wave-1");
		assert.doesNotThrow(() => assertIntegrationName("wave-1"));
		assert.throws(() => assertIntegrationName("../evil"), /Invalid integration name/);

		assert.equal(
			integrationManifestPath("wave-1"),
			join(integrationsDir, "wave-1", "manifest.json"),
		);
		assert.equal(
			integrationBasePath({ name: "wave-1" } as IntegrationManifest),
			join(integrationsDir, "wave-1", "worktree"),
		);

		const { fs, read } = memoryFs();

		// Missing manifest resolves to undefined.
		assert.equal(readIntegrationManifest("wave-1", fs), undefined);

		// Corrupted JSON throws with the manifest path.
		fs.writeFileSync(integrationManifestPath("wave-1"), "{bad", "utf-8");
		assert.throws(() => readIntegrationManifest("wave-1", fs), /invalid/);

		// Write reformats with 2-space JSON, a trailing newline, and a refreshed updatedAt.
		const manifest = manifestFor("wave-1");
		writeIntegrationManifest(manifest, fs);
		const raw = read(integrationManifestPath("wave-1"));
		assert.ok(raw !== undefined);
		assert.equal(raw.endsWith("\n"), true);
		assert.match(raw, /"updatedAt": "\d{4}-\d{2}-\d{2}T/);

		const reread = readIntegrationManifest("wave-1", fs);
		assert.equal(reread?.name, "wave-1");
		assert.ok(reread?.updatedAt !== "2026-01-01T00:00:00.000Z");
	});

	test("should create manifests through injected git/fs deps and record preflight failures", () => {
		// Preflight failure: the injected git worktree add throws, status becomes preflight-failed.
		const failing = memoryFs();
		const gitCalls: Array<Array<string>> = [];
		assert.throws(
			() =>
				createIntegrationManifest("wave-1", "issues", "main", [], true, {
					fs: failing.fs,
					git: (args) => {
						gitCalls.push([...args]);
						throw new Error("cannot add worktree");
					},
					gitTry: () => undefined,
					resolveCommit: () => "abc1234",
				}),
			/cannot add worktree/,
		);
		assert.equal(readIntegrationManifest("wave-1", failing.fs)?.status, "preflight-failed");
		assert.ok(gitCalls.some((call) => call[0] === "worktree"));

		// Duplicate manifest is rejected up front.
		const dup = memoryFs();
		writeIntegrationManifest(manifestFor("wave-2"), dup.fs);
		assert.throws(
			() =>
				createIntegrationManifest("wave-2", "issues", "main", [], true, {
					fs: dup.fs,
					git: () => "",
					gitTry: () => undefined,
					resolveCommit: () => "abc1234",
				}),
			/already exists/,
		);

		// Success: manifest is persisted with 1-based source ordering.
		const ok = memoryFs();
		const created = createIntegrationManifest(
			"wave-3",
			"issues",
			"main",
			[
				{
					branch: "sandcastle/issue-1",
					commit: "def5678",
					issue: "1",
					name: "issue-1",
					order: 0,
				},
			],
			true,
			{
				fs: ok.fs,
				git: () => "",
				gitTry: () => undefined,
				resolveCommit: () => "abc1234",
			},
		);
		assert.equal(created.status, "created");
		assert.equal(created.sources[0]?.order, 1);
		assert.equal(readIntegrationManifest("wave-3", ok.fs)?.status, "created");
	});
});

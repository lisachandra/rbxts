import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

import { integrationsDir, logsDir } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";
import type { IntegrationManifest } from "../types.js";
import {
	assertIntegrationName,
	createIntegrationManifest,
	integrationBasePath,
	integrationBranch,
	integrationLogPath,
	integrationManifestPath,
	type ManifestFs,
	readIntegrationManifest,
	resolveExistingIntegrationSource,
	resolveIssueIntegrationSource,
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

/**
 * A manifest fixture. `worktree` is relative because the schema requires it: a recorded path is
 * resolved against the integrations root, and an absolute value would replace that root.
 */
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
		worktree: `.sandcastle/integrations/${name}/${name}`,
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
			integrationBasePath({ name: "wave-1" } as IntegrationManifest, {
				existsSync: () => false,
			}),
			join(integrationsDir, "wave-1", "wave-1"),
			"the worktree directory is named after the integration, so git registers a unique name",
		);
		assert.equal(
			integrationBasePath({ name: "wave-1" } as IntegrationManifest, {
				existsSync: (path) => path === join(integrationsDir, "wave-1", "worktree"),
			}),
			join(integrationsDir, "wave-1", "worktree"),
			"a directory left by a pre-rename run still resolves",
		);
		assert.equal(
			integrationBasePath(
				{
					name: "wave-1",
					worktree: ".sandcastle/integrations/wave-1/worktree",
				} as IntegrationManifest,
				{ existsSync: () => false },
			),
			join(integrationsDir, "wave-1", "worktree"),
			"a recorded path wins, so an in-flight composition is never orphaned",
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

	test("should resolve issue and existing integration sources with status and marker verification", () => {
		// Issue source: invalid number rejected.
		assert.throws(() => resolveIssueIntegrationSource("abc", false), /Invalid issue number/);

		// Review phase not done → reject.
		assert.throws(
			() =>
				resolveIssueIntegrationSource("123", false, {
					readState: () => undefined,
				}),
			/review phase is not complete/,
		);

		// Review done but latest marker BLOCKED → reject.
		assert.throws(
			() =>
				resolveIssueIntegrationSource("123", false, {
					getLatestReviewMarker: () => "BLOCKED",
					readState: () =>
						({
							phases: { review: { status: "done" as const } },
						}) as never,
				}),
			/expected APPROVED/,
		);

		// Review done + APPROVED → resolve with commit.
		const source = resolveIssueIntegrationSource("123", false, {
			getLatestReviewMarker: () => "APPROVED",
			readState: () =>
				({
					phases: { review: { status: "done" as const } },
				}) as never,
			resolveCommit: () => "abcdef1234567",
		});
		assert.equal(source.name, "issue-123");
		assert.equal(source.commit, "abcdef1234567");
		assert.equal(source.order, 0);

		// Unreviewed bypasses the marker/status gates.
		const unreviewed = resolveIssueIntegrationSource("123", true, {
			readState: () => undefined,
			resolveCommit: () => "abcdef1234567",
		});
		assert.equal(unreviewed.issue, "123");

		// Existing integration source: missing manifest → reject.
		assert.throws(
			() =>
				resolveExistingIntegrationSource("wave-1", false, {
					readIntegrationManifest: () => undefined,
				}),
			/does not exist/,
		);

		// Existing source with status not ready → reject.
		assert.throws(
			() =>
				resolveExistingIntegrationSource("wave-1", false, {
					readIntegrationManifest: () =>
						manifestFor("wave-1", { status: "created" }) as never,
				}),
			/status is created/,
		);

		// Existing source ready + commit valid → resolve.
		const existing = resolveExistingIntegrationSource("wave-1", false, {
			commitExists: () => true,
			readIntegrationManifest: () =>
				manifestFor("wave-1", {
					headCommit: "2222222",
					status: "ready-for-human-merge",
				}),
			resolveCommit: () => "2222222",
		});
		assert.equal(existing.commit, "2222222");
		assert.equal(existing.name, "wave-1");
	});
});

/*
 * The manifest is written by whatever ran last in a worktree, and the agent inside one can write it
 * too: `sharedStateRoot` sends a linked worktree's state paths to the primary checkout, so an agent
 * there authors the same `.sandcastle/integrations/` tree the operator later cleans. Every field
 * below therefore reaches a recursive delete, and each check is on the read.
 */
describe("integration manifest containment", () => {
	test("should refuse a manifest whose worktree is absolute", () => {
		const { fs } = memoryFs();
		const absolute = join(integrationsDir, "wave-1", "elsewhere");
		writeIntegrationManifest(manifestFor("wave-1", { worktree: absolute }), fs);

		assert.throws(
			() => readIntegrationManifest("wave-1", fs),
			(error: Error) => {
				assert.match(error.message, /Integration manifest is invalid/u);
				assert.match(error.message, /worktree/u);
				assert.match(error.message, /relative/u);

				return true;
			},
			"an absolute path replaces the root in path.resolve, so it cannot be recorded",
		);
	});

	test("should refuse a manifest whose name is not an integration name", () => {
		/*
		 * Written as raw JSON, not through `writeIntegrationManifest`: the write path already refuses
		 * this name, and the read must too. The file this guards against is one a hand edit or an
		 * agent wrote, which never passed the write path at all.
		 */
		const { fs } = memoryFs();
		fs.writeFileSync(
			integrationManifestPath("wave-1"),
			JSON.stringify(manifestFor("wave-1", { name: "../../evil" })),
			"utf-8",
		);

		assert.throws(
			() => readIntegrationManifest("wave-1", fs),
			(error: Error) => {
				assert.match(error.message, /Integration manifest is invalid/u);
				assert.match(error.message, /name/u);

				return true;
			},
			"the name is a path segment in four places, so file content needs the CLI's pattern",
		);
	});

	test("should refuse a manifest missing a required field, naming it", () => {
		const { fs } = memoryFs();
		const missing = { ...manifestFor("wave-1") } as Partial<IntegrationManifest>;
		delete missing.status;
		fs.writeFileSync(integrationManifestPath("wave-1"), JSON.stringify(missing), "utf-8");

		assert.throws(
			() => readIntegrationManifest("wave-1", fs),
			(error: Error) => {
				assert.match(error.message, /Integration manifest is invalid/u);
				assert.match(error.message, /status/u);

				return true;
			},
			"a missing field would otherwise reach a path as undefined",
		);
	});

	test("should refuse a worktree that escapes into a sibling integration", () => {
		/*
		 * The check that has to be the integration's own directory rather than the integrations root:
		 * containment in the root passes here, and the redirect the seam exists to stop still happens.
		 */
		assert.throws(
			() =>
				integrationBasePath(
					manifestFor("wave-1", {
						worktree: ".sandcastle/integrations/wave-2/wave-2",
					}),
				),
			(error: Error) => {
				assert.match(error.message, /not inside/u);
				assert.match(error.message, /wave-2/u);

				return true;
			},
		);
	});

	test("should refuse a worktree that climbs out with ..", () => {
		assert.throws(
			() =>
				integrationBasePath(
					manifestFor("wave-1", {
						worktree: ".sandcastle/integrations/wave-1/../../../elsewhere",
					}),
				),
			/not inside/u,
		);
	});

	test("should keep resolving a worktree this runner wrote", () => {
		// The positive half: the guard has to admit the paths createIntegrationManifest writes.
		const created = createIntegrationManifest("wave-4", "issues", "main", [], true, {
			fs: memoryFs().fs,
			git: () => "",
			gitTry: () => undefined,
			resolveCommit: () => "abc1234",
		});

		assert.equal(
			integrationBasePath(created, { existsSync: () => false }),
			join(integrationsDir, "wave-4", "wave-4"),
		);
	});
});

describe("integration path builders", () => {
	test("should refuse an integration name that resolves outside its root", () => {
		for (const build of [integrationManifestPath, integrationLogPath]) {
			assert.throws(() => build("../evil"), /Invalid integration name/u);
			assert.throws(() => build("wave-1/../../evil"), /Invalid integration name/u);
		}
	});

	test("should build both paths inside their own roots", () => {
		assert.equal(
			integrationManifestPath("wave-1"),
			join(integrationsDir, "wave-1", "manifest.json"),
		);
		assert.equal(integrationLogPath("wave-1"), join(logsDir, "integration-wave-1.log"));
	});

	test("should create nothing outside the roots for an escaping name", () => {
		/*
		 * The property, not the throw: a name that would escape must leave the filesystem untouched.
		 * The builder is the only thing that could create it, and it refuses before the write.
		 */
		const escape = "../escaped-integration";
		const outside = join(integrationsDir, "..", "escaped-integration");

		assert.throws(() => integrationManifestPath(escape), /Invalid integration name/u);
		assert.equal(
			existsSync(outside),
			false,
			"nothing was created outside the integrations root",
		);
	});
});

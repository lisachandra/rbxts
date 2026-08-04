/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
	abortIntegration,
	assertIntegrationName,
	cleanupIntegration,
	createIntegrationManifest,
	integrateManifestSource,
	integrationBranch,
	printIntegrationStatus,
	readIntegrationManifest,
	resolveExistingIntegrationSource,
	resolveIssueIntegrationSource,
	resumeIntegration,
	runNewIntegration,
	writeIntegrationManifest,
} from "./integrations.js";
import { main } from "./main.js";
import { io } from "./runtime.js";
import { writeState } from "./state.js";
import {
	cleanupIssueArtifacts,
	gitStub,
	integrationsDir,
	makeState,
	registerTestHooks,
	stubExecSync,
	uniqueIssue,
} from "./test-helpers.js";

registerTestHooks();

describe("integration names", () => {
	test("assertIntegrationName and integrationBranch", () => {
		assert.doesNotThrow(() => {
			assertIntegrationName("wave-1");
		});
		assert.throws(() => {
			assertIntegrationName("../evil");
		}, /Invalid integration name/);
		assert.equal(integrationBranch("wave-1"), "sandcastle/integration/wave-1");
	});
});

describe("integration manifest I/O", () => {
	test("integration manifest invalid JSON throws; abort/status/cleanup paths", () => {
		const name = `test-int-${Date.now()}`;
		const dir = join(integrationsDir, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "manifest.json"), "{bad", "utf-8");
		assert.throws(() => readIntegrationManifest(name), /invalid/);

		const manifest = {
			base: { commit: "abc1234", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
			name,
			sources: [
				{
					branch: "sandcastle/issue-1",
					commit: "def5678",
					issue: "1",
					name: "issue-1",
					order: 1,
				},
			],
			status: "created" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);
		assert.equal(readIntegrationManifest(name)?.name, name);

		printIntegrationStatus(name);
		abortIntegration(name);
		assert.equal(readIntegrationManifest(name)?.status, "aborted");

		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		gitStub({
			file: (args) => {
				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				if (args[0] === "status" && args[1] === "--porcelain") {
					return " M file";
				}

				if (args[0] === "worktree" && args[1] === "remove") {
					return "";
				}

				if (args[0] === "status" && args[1] === "--short") {
					return " M file";
				}

				return "";
			},
		});
		assert.throws(() => {
			cleanupIntegration(name, false);
		}, /dirty or has an active merge/);
		cleanupIntegration(name, true);
		assert.equal(readIntegrationManifest(name)?.status, "aborted");

		rmSync(dir, { force: true, recursive: true });
	});

	test("resolveIssueIntegrationSource gates review completion", () => {
		const issue = uniqueIssue();
		assert.throws(() => resolveIssueIntegrationSource("abc", false), /Invalid issue number/);
		assert.throws(
			() => resolveIssueIntegrationSource(issue, false),
			/review phase is not complete/,
		);

		writeState(makeState(issue, { review: "done" }));
		stubExecSync(
			JSON.stringify({
				comments: [{ body: "Sandcastle-Review: BLOCKED" }],
			}),
		);
		assert.throws(() => resolveIssueIntegrationSource(issue, false), /expected APPROVED/);

		stubExecSync(
			JSON.stringify({
				comments: [{ body: "Sandcastle-Review: APPROVED" }],
			}),
		);
		gitStub({
			file: (args) => {
				if (args[0] === "rev-parse") {
					return "abcdef1234567";
				}

				return "";
			},
			sync: () => JSON.stringify({ comments: [{ body: "Sandcastle-Review: APPROVED" }] }),
		});
		const source = resolveIssueIntegrationSource(issue, false);
		assert.equal(source.issue, issue);
		assert.equal(source.commit, "abcdef1234567");

		const unreviewed = resolveIssueIntegrationSource(issue, true);
		assert.equal(unreviewed.issue, issue);

		cleanupIssueArtifacts(issue);
	});

	test("resolveExistingIntegrationSource validates status and commits", () => {
		const name = `compose-${Date.now()}`;
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			headCommit: "2222222",
			kind: "integrations" as const,
			name,
			sources: [],
			status: "created" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);
		assert.throws(() => resolveExistingIntegrationSource(name, false), /status is created/);

		writeIntegrationManifest({ ...manifest, status: "ready-for-human-merge" });
		gitStub({
			file: (args) => {
				if (args[0] === "cat-file") {
					return "";
				}

				if (args[0] === "rev-parse") {
					return "2222222";
				}

				return "";
			},
		});
		const source = resolveExistingIntegrationSource(name, false);
		assert.equal(source.commit, "2222222");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});
});

describe("integration composition", () => {
	test("createIntegrationManifest preflight failure records status", () => {
		const name = `preflight-${Date.now()}`;
		gitStub({
			file: (args) => {
				if (args[0] === "rev-parse") {
					return "abc1234";
				}

				if (args[0] === "show-ref") {
					throw new Error("missing");
				}

				if (args[0] === "worktree") {
					throw new Error("cannot add worktree");
				}

				return "";
			},
		});

		assert.throws(
			() =>
				createIntegrationManifest(
					name,
					"issues",
					"main",
					[
						{
							branch: "sandcastle/issue-1",
							commit: "def5678",
							issue: "1",
							name: "issue-1",
							order: 1,
						},
					],
					true,
				),
			/cannot add worktree/,
		);
		assert.equal(readIntegrationManifest(name)?.status, "preflight-failed");
		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("integrateManifestSource short-circuits when already ancestor", async () => {
		const name = `ancestor-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
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
			status: "merging" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);

		gitStub({
			file: (args) => {
				if (args[0] === "merge-base") {
					return "";
				}

				return "";
			},
		});

		const source = manifest.sources[0];
		assert.ok(source);
		await integrateManifestSource(manifest, source, worktree, "m", "low", "dirac");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("integrateManifestSource resolves merge conflicts via agent", async () => {
		const name = `conflict-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
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
			status: "merging" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);

		let mergeAttempts = 0;
		let resolverRan = false;
		gitStub({
			file: (args) => {
				if (args[0] === "merge-base") {
					throw new Error("not ancestor");
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				if (args[0] === "diff") {
					/*
					 * After merge fails, report unmerged paths so the conflict path is taken.
					 * After the resolver runs, report clean.
					 */
					return resolverRan ? "" : mergeAttempts > 0 ? "conflicted.ts" : "";
				}

				if (args[0] === "merge") {
					mergeAttempts += 1;
					throw new Error("conflict");
				}

				if (args[0] === "commit") {
					return "";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
		});
		io.run = (async () => {
			resolverRan = true;
			return { commits: [], stdout: "resolved" };
		}) as unknown as typeof io.run;

		// MERGE_HEAD should not exist so merge path is taken.
		const source = manifest.sources[0];
		assert.ok(source);
		await integrateManifestSource(manifest, source, worktree, "m", "low", "dirac");
		assert.equal(readIntegrationManifest(name)?.status, "conflict-resolution-required");
		assert.equal(resolverRan, true);

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("resumeIntegration rejects terminal statuses and runNewIntegration validates sources", async () => {
		const name = `resume-${Date.now()}`;
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
			name,
			sources: [],
			status: "ready-for-human-merge" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);
		await assert.rejects(
			async () => resumeIntegration(name, "m", "low", "dirac"),
			/cannot be resumed/,
		);

		await assert.rejects(
			async () => runNewIntegration("issues", "x", [], "main", true, "m", "low", "dirac"),
			/At least one integration source/,
		);

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("main dispatches integration-abort", async () => {
		const name = `abort-main-${Date.now()}`;
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
			name,
			sources: [],
			status: "created" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);
		process.env.DIRAC_SANDCASTLE_MODEL = "m";
		process.argv = ["node", "main.ts", "integration-abort", "--name", name];
		await main();
		assert.equal(readIntegrationManifest(name)?.status, "aborted");
		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});
});

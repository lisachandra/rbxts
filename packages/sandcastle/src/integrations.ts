/*
 * Integration composition: merges approved issue branches (or other
 * integrations) onto a base branch in a dedicated worktree, resolving merge
 * conflicts with the conflict-resolver agent, then runs a review pass before
 * handing the branch off for a human merge.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import { createAgent, skillsForPrompt } from "./agent.js";
import {
	commitExists,
	git,
	gitTry,
	hasUnmergedPaths,
	mergeInProgress,
	resolveCommit,
} from "./git.js";
import { config, integrationsDir, io, logsDir } from "./runtime.js";
import { getLatestReviewMarker, readState } from "./state.js";
import type {
	AgentBackend,
	IntegrationKind,
	IntegrationManifest,
	IntegrationSource,
	IntegrationStatus,
} from "./types.js";
import { sandboxProvider } from "./worktree.js";

export const integrationBranch = (name: string): string => `sandcastle/integration/${name}`;

function integrationManifestPath(name: string): string {
	return pathResolve(integrationsDir, name, "manifest.json");
}

export function assertIntegrationName(name: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
		throw new Error(
			`Invalid integration name ${JSON.stringify(name)}; use letters, numbers, ., _, or -`,
		);
	}
}

export function readIntegrationManifest(name: string): undefined | IntegrationManifest {
	const path = integrationManifestPath(name);
	if (!existsSync(path)) {
		return undefined;
	}

	try {
		return JSON.parse(readFileSync(path, "utf-8")) as IntegrationManifest;
	} catch {
		throw new Error(`Integration manifest is invalid: ${path}`);
	}
}

export function writeIntegrationManifest(manifest: IntegrationManifest): void {
	mkdirSync(dirname(integrationManifestPath(manifest.name)), { recursive: true });
	manifest.updatedAt = new Date().toISOString();
	writeFileSync(
		integrationManifestPath(manifest.name),
		`${JSON.stringify(manifest, undefined, 2)}\n`,
		"utf-8",
	);
}

function integrationBasePath(manifest: IntegrationManifest): string {
	return pathResolve(integrationsDir, manifest.name, "worktree");
}

function assertCleanMergeResolution(manifest: IntegrationManifest): void {
	const worktree = integrationBasePath(manifest);
	if (hasUnmergedPaths(worktree)) {
		throw new Error(
			`Unmerged paths remain in ${worktree}; resolve every conflict before continuing.`,
		);
	}

	if (mergeInProgress(worktree)) {
		git(["commit", "--no-edit"], worktree);
	}
}

const integrationReviewStatuses: ReadonlySet<IntegrationStatus> = new Set([
	"ready-for-human-merge",
	"review-passed",
]);

export function resolveIssueIntegrationSource(
	issueNumber: string,
	allowUnreviewed: boolean,
): IntegrationSource {
	if (!/^\d+$/.test(issueNumber)) {
		throw new Error(`Invalid issue number ${JSON.stringify(issueNumber)}; expected digits.`);
	}

	const branch = `sandcastle/issue-${issueNumber}`;
	const state = readState(issueNumber);
	if (!allowUnreviewed && state?.phases.review.status !== "done") {
		throw new Error(
			`Cannot integrate issue #${issueNumber}: its review phase is not complete. Use --allow-unreviewed to override.`,
		);
	}

	if (!allowUnreviewed) {
		const marker = getLatestReviewMarker(issueNumber);
		if (marker !== "APPROVED") {
			throw new Error(
				`Cannot integrate issue #${issueNumber}: latest review marker is ${marker ?? "missing"}; expected APPROVED.`,
			);
		}
	}

	const commit = resolveCommit(branch);
	return { branch, commit, issue: issueNumber, name: `issue-${issueNumber}`, order: 0 };
}

export function resolveExistingIntegrationSource(
	name: string,
	allowUnreviewed: boolean,
): IntegrationSource {
	assertIntegrationName(name);
	const source = readIntegrationManifest(name);
	if (!source) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	if (!allowUnreviewed && !integrationReviewStatuses.has(source.status)) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: status is ${source.status}. Use --allow-unreviewed to override.`,
		);
	}

	if (
		source.headCommit !== undefined &&
		source.headCommit !== "" &&
		!commitExists(source.headCommit)
	) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: recorded commit ${source.headCommit} no longer exists.`,
		);
	}

	const currentCommit = resolveCommit(source.branch);
	if (
		source.headCommit !== undefined &&
		source.headCommit !== "" &&
		currentCommit !== source.headCommit
	) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: branch moved since its manifest was recorded.`,
		);
	}

	if (!commitExists(currentCommit)) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: branch commit ${currentCommit} no longer exists.`,
		);
	}

	return { branch: source.branch, commit: currentCommit, name, order: 0 };
}

export function createIntegrationManifest(
	name: string,
	kind: IntegrationKind,
	baseRef: string,
	sources: Array<IntegrationSource>,
	allowUnreviewed: boolean,
): IntegrationManifest {
	assertIntegrationName(name);
	if (readIntegrationManifest(name)) {
		throw new Error(
			`Integration ${JSON.stringify(name)} already exists; use integration-resume or choose another name.`,
		);
	}

	const now = new Date().toISOString();
	const manifest: IntegrationManifest = {
		allowUnreviewed: allowUnreviewed || undefined,
		base: { commit: "", ref: baseRef },
		branch: integrationBranch(name),
		createdAt: now,
		kind,
		name,
		sources: sources.map((source, index) => ({ ...source, order: index + 1 })),
		status: "created",
		updatedAt: now,
		worktree: `${config.dir}/integrations/${name}/worktree`,
	};

	try {
		manifest.base.commit = resolveCommit(baseRef);
		if (
			gitTry(["show-ref", "--verify", "--quiet", `refs/heads/${manifest.branch}`]) !==
			undefined
		) {
			throw new Error(`Branch ${manifest.branch} already exists.`);
		}

		if (existsSync(integrationBasePath(manifest))) {
			throw new Error(`Worktree path already exists: ${integrationBasePath(manifest)}`);
		}

		writeIntegrationManifest(manifest);
		mkdirSync(dirname(integrationBasePath(manifest)), { recursive: true });
		git([
			"worktree",
			"add",
			"-b",
			manifest.branch,
			integrationBasePath(manifest),
			manifest.base.commit,
		]);
	} catch (err) {
		manifest.status = "preflight-failed";
		manifest.lastError = String(err);
		writeIntegrationManifest(manifest);
		throw err;
	}

	return manifest;
}

export async function runConflictResolver(
	manifest: IntegrationManifest,
	source: IntegrationSource,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	const worktree = integrationBasePath(manifest);
	const completionSignal = randomUUID();
	const sourceContext = JSON.stringify(
		{
			base: manifest.base,
			integration: manifest.name,
			kind: manifest.kind,
			manifestPath: integrationManifestPath(manifest.name),
			source,
		},
		undefined,
		2,
	);
	await io.run({
		agent: createAgent(agentBackend, model, effort, completionSignal),
		branchStrategy: { type: "head" },
		completionSignal,
		cwd: worktree,
		logging: {
			type: "file",
			path: pathResolve(logsDir, `integration-${manifest.name}.log`),
			verbose: true,
		},
		maxIterations: 10,
		name: `resolve ${manifest.name} <- ${source.name}`,
		promptArgs: {
			COMPLETION_SIGNAL: completionSignal,
			INTEGRATION_NAME: manifest.name,
			SKILLS: "- resolving-merge-conflicts",
			SOURCE_CONTEXT: sourceContext,
			SOURCE_NAME: source.name,
		},
		promptFile: config.prompts.resolveConflicts,
		sandbox: sandboxProvider,
	});
}

export async function runIntegrationReview(
	manifest: IntegrationManifest,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	const completionSignal = randomUUID();
	const sourceContext = JSON.stringify(manifest.sources, undefined, 2);
	await io.run({
		agent: createAgent(agentBackend, model, effort, completionSignal),
		branchStrategy: { type: "head" },
		completionSignal,
		cwd: integrationBasePath(manifest),
		logging: {
			type: "file",
			path: pathResolve(logsDir, `integration-${manifest.name}.log`),
			verbose: true,
		},
		maxIterations: 5,
		name: `review integration ${manifest.name}`,
		promptArgs: {
			BASE_COMMIT: manifest.base.commit,
			BASE_REF: manifest.base.ref,
			BRANCH: manifest.branch,
			COMPLETION_SIGNAL: completionSignal,
			INTEGRATION_NAME: manifest.name,
			SKILLS: skillsForPrompt("review"),
			SOURCES: sourceContext,
		},
		promptFile: config.prompts.reviewIntegration,
		sandbox: sandboxProvider,
	});
}

export async function integrateManifestSource(
	manifest: IntegrationManifest,
	source: IntegrationSource,
	worktree: string,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	if (gitTry(["merge-base", "--is-ancestor", source.commit, "HEAD"], worktree) !== undefined) {
		return;
	}

	if (mergeInProgress(worktree)) {
		manifest.status = "conflict-resolution-required";
		manifest.lastError = `Conflict resolution is still required for ${source.name}.`;
		writeIntegrationManifest(manifest);
		await runConflictResolver(manifest, source, model, effort, agentBackend);
		assertCleanMergeResolution(manifest);
		return;
	}

	try {
		git(["merge", "--no-ff", source.commit, "-m", `Integrate ${source.name}`], worktree);
	} catch (err) {
		if (!hasUnmergedPaths(worktree)) {
			throw err;
		}

		manifest.status = "conflict-resolution-required";
		manifest.lastError = `Conflict while integrating ${source.name}: ${String(err)}`;
		writeIntegrationManifest(manifest);
		console.error(
			`  Conflict while integrating ${source.name}; invoking resolving-merge-conflicts.`,
		);
		await runConflictResolver(manifest, source, model, effort, agentBackend);
		assertCleanMergeResolution(manifest);
	}
}

export async function continueIntegration(
	manifest: IntegrationManifest,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	const worktree = integrationBasePath(manifest);
	if (!existsSync(worktree)) {
		throw new Error(`Integration worktree is missing: ${worktree}`);
	}

	try {
		manifest.status = "merging";
		manifest.lastError = undefined;
		writeIntegrationManifest(manifest);
		const start = manifest.currentSource ?? 0;

		for (let index = start; index < manifest.sources.length; index++) {
			const source = manifest.sources[index];
			if (source === undefined) {
				throw new Error(`Integration source at index ${index} is missing.`);
			}

			manifest.currentSource = index;
			writeIntegrationManifest(manifest);

			await integrateManifestSource(manifest, source, worktree, model, effort, agentBackend);

			if (
				gitTry(["merge-base", "--is-ancestor", source.commit, "HEAD"], worktree) ===
				undefined
			) {
				throw new Error(`Conflict resolver did not complete the merge for ${source.name}.`);
			}

			manifest.currentSource = index + 1;
			manifest.status = "merging";
			writeIntegrationManifest(manifest);
		}

		manifest.status = "integrated";
		writeIntegrationManifest(manifest);
		console.log(`  ✓ Merged ${manifest.sources.length} source(s) into ${manifest.branch}.`);

		manifest.status = "reviewing";
		writeIntegrationManifest(manifest);
		await runIntegrationReview(manifest, model, effort, agentBackend);
		assertCleanMergeResolution(manifest);
		if (git(["status", "--porcelain"], worktree).length > 0) {
			throw new Error(
				"Integration review left uncommitted changes; commit review corrections before handoff.",
			);
		}

		manifest.headCommit = resolveCommit(manifest.branch);
		manifest.status = "review-passed";
		writeIntegrationManifest(manifest);
		manifest.status = "ready-for-human-merge";
		writeIntegrationManifest(manifest);
		console.log("\nIntegration composition ready for human merge.");
		console.log(`\nBranch: ${manifest.branch}`);
		console.log(`Worktree: ${worktree}`);
	} catch (err) {
		if (manifest.status === "reviewing") {
			manifest.status = "review-failed";
		} else if (manifest.status === "merging") {
			manifest.status = "conflict-resolution-required";
		}

		manifest.lastError = String(err);
		writeIntegrationManifest(manifest);
		throw err;
	}
}

export async function runNewIntegration(
	kind: IntegrationKind,
	name: string,
	sourceNames: Array<string>,
	baseRef: string,
	allowUnreviewed: boolean,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	if (sourceNames.length === 0) {
		throw new Error("At least one integration source is required.");
	}

	const sourceResolver =
		kind === "issues" ? resolveIssueIntegrationSource : resolveExistingIntegrationSource;
	const sources = sourceNames.map((sourceName) => sourceResolver(sourceName, allowUnreviewed));
	const manifest = createIntegrationManifest(name, kind, baseRef, sources, allowUnreviewed);
	await continueIntegration(manifest, model, effort, agentBackend);
}

export async function resumeIntegration(
	name: string,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	if (manifest.status === "ready-for-human-merge" || manifest.status === "aborted") {
		throw new Error(
			`Integration ${JSON.stringify(name)} cannot be resumed from status ${manifest.status}.`,
		);
	}

	await continueIntegration(manifest, model, effort, agentBackend);
}

export function printIntegrationStatus(name: string): void {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	const worktree = integrationBasePath(manifest);
	console.log(`\nIntegration: ${manifest.name}`);
	console.log(`Kind: ${manifest.kind}`);
	console.log(`Status: ${manifest.status}`);
	console.log(`Base: ${manifest.base.ref} (${manifest.base.commit || "unresolved"})`);
	console.log(`Branch: ${manifest.branch}`);
	console.log(`Worktree: ${worktree} (${existsSync(worktree) ? "exists" : "missing"})`);
	console.log(
		(() => {
			const sourceSummary =
				manifest.sources
					.map((source) => `${source.order}. ${source.name}@${source.commit}`)
					.join(", ") || "none";
			return `Sources: ${sourceSummary}`;
		})(),
	);
	if (existsSync(worktree)) {
		console.log(`Git: ${git(["status", "--short"], worktree) || "clean"}`);
	}

	if (manifest.lastError !== undefined && manifest.lastError !== "") {
		console.log(`Last error: ${manifest.lastError}`);
	}
}

export function abortIntegration(name: string): void {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	manifest.status = "aborted";
	manifest.lastError = "Aborted by operator; worktree was preserved for inspection.";
	writeIntegrationManifest(manifest);
	console.log(
		`Integration ${name} marked aborted. The worktree was preserved; use integration-cleanup when it is safe to remove.`,
	);
}

export function cleanupIntegration(name: string, force: boolean): void {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	const worktree = integrationBasePath(manifest);
	if (existsSync(worktree)) {
		if (
			!force &&
			(mergeInProgress(worktree) || git(["status", "--porcelain"], worktree).length > 0)
		) {
			throw new Error(
				"Worktree is dirty or has an active merge. Inspect it first or pass --force to cleanup.",
			);
		}

		git(["worktree", "remove", ...(force ? ["--force"] : []), worktree]);
	}

	manifest.status = "aborted";
	manifest.lastError = "Worktree cleaned up by operator; branch was preserved.";
	writeIntegrationManifest(manifest);
	console.log(`Cleaned up worktree for ${name}; branch ${manifest.branch} was preserved.`);
}

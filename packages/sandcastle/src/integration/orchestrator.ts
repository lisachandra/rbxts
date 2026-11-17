/*
 * Orchestrator for integration composition.
 *
 * Owns the state transition engine for `continueIntegration`
 * (merging → conflict-resolution-required → integrated → reviewing →
 * review-passed → ready-for-human-merge, plus review-failed/blocked), the
 * marker-backed agent phases (conflict resolver, integration review), the
 * lifecycle commands (runNewIntegration, resumeIntegration, printIntegrationStatus,
 * abortIntegration, cleanupIntegration, resetIntegration), and the shared worktree
 * preparation seam that delegates to `setupWorktree`.
 */

import { existsSync, rmSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import type { SetupOutput } from "../config.js";
import { git, gitTry, hasUnmergedPaths, mergeInProgress, resolveCommit } from "../git.js";
import { backendSupportsDigest, fileLogging } from "../logging.js";
import { markerPath, runMarkerPhase } from "../markers.js";
import { queueRulesForPrompt } from "../prompts/queue.js";
import { setupNoteFor } from "../prompts/setup-note.js";
import { skillsForPrompt } from "../prompts/skills.js";
import { saveSession } from "../providers/session-store.js";
import { runPhaseWithRetry } from "../retry.js";
import { config, io, logsDir } from "../runtime.js";
import { runSessioned } from "../session-resume.js";
import type {
	AgentBackend,
	AgentPhaseName,
	IntegrationKind,
	IntegrationManifest,
	IntegrationSource,
	ResolvedAgentStep,
} from "../types.js";
import { removeWorktree, resolveSetupOutput, sandboxProvider, setupWorktree } from "../worktree.js";
import type { SetupWorktreeOptions } from "../worktree.js";
import {
	assertIntegrationName,
	createIntegrationManifest,
	integrationBasePath,
	integrationManifestPath,
	readIntegrationManifest,
	resolveExistingIntegrationSource,
	resolveIssueIntegrationSource,
	writeIntegrationManifest,
} from "./manifest.js";
import {
	assertCleanMergeResolution,
	integrateManifestSource,
	partitionDrift,
	quarantineWorktreeDrift,
} from "./merger.js";
import type { ConflictResolverRunner } from "./merger.js";

export type { SetupWorktreeOptions } from "../worktree.js";

export type { ConflictResolverRunner } from "./merger.js";

export type IntegrationReviewRunner = (
	manifest: IntegrationManifest,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	step?: ResolvedAgentStep,
	setupNote?: string,
) => Promise<void>;

/**
 * Prepare an integration worktree before agents run, delegating to the shared `setupWorktree`
 * (`.env` copy, `setupCommands`, and symlinked dirs) so issue and integration paths stay uniform.
 */
export function prepareIntegrationWorktree(
	worktree: string,
	ignoreSetup: boolean,
	skipSetup: boolean,
	setupOutput?: SetupOutput,
	worktreePreparer: (
		path: string,
		options: SetupWorktreeOptions,
	) => string | undefined = setupWorktree,
): string | undefined {
	const preparer = worktreePreparer ?? setupWorktree;
	return preparer(worktree, {
		ignoreSetup,
		logKind: "integration",
		output: resolveSetupOutput(setupOutput, "log"),
		skipSetup,
	});
}

/** Resolve a merge conflict on the integration worktree via the resolving-merge-conflicts agent. */
export async function runConflictResolver(
	manifest: IntegrationManifest,
	source: IntegrationSource,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	step?: ResolvedAgentStep,
	setupNote = "",
): Promise<void> {
	const worktree = integrationBasePath(manifest);
	const marker = markerPath(`${manifest.name}.resolve`);
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
	const resolveBackend = step?.agentBackend ?? agentBackend;
	const resolveEffort = step?.effort ?? effort;
	const resolveModel = step?.model ?? model;
	const scope = `${manifest.name}.resolve`;
	await runPhaseWithRetry(
		() =>
			runSessioned({ backend: resolveBackend, scope }, ({ capture, resumed }) =>
				runMarkerPhase({
					agentBackend: resolveBackend,
					effort: resolveEffort,
					marker,
					model: resolveModel,
					name: `resolve ${manifest.name} <- ${source.name}`,
					promptArgs: {
						INTEGRATION_NAME: manifest.name,
						SKILLS: "- resolving-merge-conflicts",
						SOURCE_CONTEXT: sourceContext,

						QUEUE_RULES: queueRulesForPrompt({ composed: true }),
						SETUP_NOTE: setupNote,
						SOURCE_NAME: source.name,
					},
					promptFile: config.prompts.resolveConflicts,
					run: (options) =>
						io.run({
							...options,
							branchStrategy: { type: "head" },
							cwd: worktree,
							sandbox: sandboxProvider,
						}),
					runOptions: {
						...(resumed !== undefined ? { resumeSession: resumed.sessionId } : {}),
						logging: fileLogging(
							pathResolve(logsDir, `integration-${manifest.name}.log`),
							{
								digest: backendSupportsDigest(resolveBackend),
								onSessionCaptured: (sessionId) =>
									saveSession(scope, { backend: resolveBackend, sessionId }),
								sessionCapture: capture,
							},
						),
					},
				}),
			),
		`resolve ${manifest.name}`,
	);
}

/** Run the integration review agent pass and record its marker. */
export async function runIntegrationReview(
	manifest: IntegrationManifest,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	step?: ResolvedAgentStep,
	setupNote = "",
): Promise<void> {
	const marker = markerPath(`${manifest.name}.review`);
	const sourceContext = JSON.stringify(manifest.sources, undefined, 2);
	const reviewBackend = step?.agentBackend ?? agentBackend;
	const reviewEffort = step?.effort ?? effort;
	const reviewModel = step?.model ?? model;
	const scope = `${manifest.name}.review`;
	await runPhaseWithRetry(
		() =>
			runSessioned({ backend: reviewBackend, scope }, ({ capture, resumed }) =>
				runMarkerPhase({
					agentBackend: reviewBackend,
					effort: reviewEffort,
					marker,
					model: reviewModel,
					name: `review integration ${manifest.name}`,
					promptArgs: {
						BASE_COMMIT: manifest.base.commit,
						BASE_REF: manifest.base.ref,
						BRANCH: manifest.branch,
						INTEGRATION_NAME: manifest.name,
						QUEUE_RULES: queueRulesForPrompt({ composed: true }),

						SETUP_NOTE: setupNote,
						SKILLS: skillsForPrompt("review"),
						SOURCES: sourceContext,
					},
					promptFile: config.prompts.reviewIntegration,
					run: (options) =>
						io.run({
							...options,
							branchStrategy: { type: "head" },
							cwd: integrationBasePath(manifest),
							sandbox: sandboxProvider,
						}),
					runOptions: {
						...(resumed !== undefined ? { resumeSession: resumed.sessionId } : {}),
						logging: fileLogging(
							pathResolve(logsDir, `integration-${manifest.name}.log`),
							{
								digest: backendSupportsDigest(reviewBackend),
								onSessionCaptured: (sessionId) =>
									saveSession(scope, { backend: reviewBackend, sessionId }),
								sessionCapture: capture,
							},
						),
					},
				}),
			),
		`review integration ${manifest.name}`,
	);
}

/** Injectable seam for the orchestrator's worktree prep and marker agent phases. */
export interface OrchestratorDeps {
	prepareWorktree: (
		worktree: string,
		ignoreSetup: boolean,
		skipSetup: boolean,
		setupOutput?: SetupOutput,
	) => string | undefined;
	runConflictResolver: ConflictResolverRunner;
	runIntegrationReview: IntegrationReviewRunner;
}

/** Treat dependency injection as an internal test hook and a default-resolution seam. */
export function resolveOrchestratorDeps(deps?: Partial<OrchestratorDeps>): OrchestratorDeps {
	return {
		prepareWorktree: prepareIntegrationWorktree,
		runConflictResolver,
		runIntegrationReview,
		...deps,
	};
}

/**
 * Merge every source of an integration onto its base branch in a dedicated worktree, resolving
 * conflicts and reviewing the result before handing the branch off for a human merge.
 *
 * The manifest is written after every transition so `resumeIntegration` can crash-safely pick up
 * from `currentSource`. On failure the status is downgraded to `conflict-resolution-required`,
 * `blocked`, or `review-failed` with `lastError` recorded.
 *
 * @rejects {Error} When the worktree is missing, a source merge cannot complete, or the review
 *                    pass leaves the worktree dirty.
 */
export async function continueIntegration(
	manifest: IntegrationManifest,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	ignoreSetup = false,
	skipSetup = false,
	steps?: Record<AgentPhaseName, ResolvedAgentStep>,
	quarantineDrift = false,
	deps?: Partial<OrchestratorDeps>,
	setupOutput?: SetupOutput,
): Promise<void> {
	const merged = { ...resolveOrchestratorDeps(deps) };
	const worktree = integrationBasePath(manifest);
	if (!existsSync(worktree)) {
		throw new Error(`Integration worktree is missing: ${worktree}`);
	}

	try {
		const setupFailure = merged.prepareWorktree(worktree, ignoreSetup, skipSetup, setupOutput);
		const setupNote = setupNoteFor(setupFailure);
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

			await integrateManifestSource(
				manifest,
				source,
				worktree,
				model,
				effort,
				agentBackend,
				steps?.resolve,
				quarantineDrift,
				{ runConflictResolver: merged.runConflictResolver },
				setupNote,
			);

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

		/*
		 * A review that already ran to completion and committed its corrections does not need to run
		 * again merely because the hand-off afterwards failed. `reviewHead` records the branch tip the
		 * reviewer approved; when a resume finds HEAD still there, the agent phase is work already
		 * done, and re-running it costs a full review budget to arrive at the same commit.
		 */
		const reviewHead = resolveCommit("HEAD", worktree);
		if (manifest.reviewHead === reviewHead) {
			console.log(
				`  ✓ Review already approved this branch tip (${reviewHead}); not re-running it.`,
			);
		} else {
			manifest.status = "reviewing";
			writeIntegrationManifest(manifest);
			await merged.runIntegrationReview(
				manifest,
				model,
				effort,
				agentBackend,
				steps?.integrationReview,
				setupNote,
			);
			manifest.reviewHead = resolveCommit("HEAD", worktree);
			writeIntegrationManifest(manifest);
		}

		assertCleanMergeResolution(manifest);
		/*
		 * The hand-off gate asks the same question as the pre-merge guard — "does the branch carry
		 * changes no source commit accounts for?" — so it consumes `partitionDrift` rather than a raw
		 * `git status`. A worktree-only difference (untracked build output, a lockfile a setup command
		 * generated inside a submodule) cannot reach a human merge, and failing the whole hand-off for
		 * it left compositions unable to finish at all: the retry re-ran the review and failed on the
		 * same surviving file.
		 *
		 * Post-review dirt is agent churn by construction, so it is always quarantined — stashed and
		 * recorded, never discarded — instead of refusing the hand-off. `quarantineDrift` keeps its
		 * meaning for the pre-merge phase, where the dirt may be a human's in-flight work.
		 */
		const { blocking, submodules, untracked } = partitionDrift(worktree);
		if (submodules.length > 0) {
			console.warn(
				`  ⚠ Submodule content is dirty but the recorded pointers are unchanged, so the branch is unaffected: ${submodules.join(", ")}`,
			);
		}

		if (blocking.length > 0) {
			quarantineWorktreeDrift(manifest, worktree, blocking);
		}

		if (untracked.length > 0) {
			console.warn(
				`  ⚠ ${String(untracked.length)} untracked path(s) remain in the worktree; they are not on the branch: ${untracked.join(", ")}`,
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
			manifest.status =
				mergeInProgress(worktree) || hasUnmergedPaths(worktree)
					? "conflict-resolution-required"
					: "blocked";
		}

		manifest.lastError = String(err);
		writeIntegrationManifest(manifest);
		throw err;
	}
}

/**
 * Create a new integration manifest from named sources and run it through composition.
 *
 * Requires at least one source. `issues` sources must have an APPROVED review marker unless
 * `allowUnreviewed` is set; `integrations` sources must be ready-for-human-merge.
 *
 * @rejects {Error} When no source is named, a source cannot be resolved, or the composition
 *                    run fails.
 */
export async function runNewIntegration(
	kind: IntegrationKind,
	name: string,
	sourceNames: Array<string>,
	baseRef: string,
	allowUnreviewed: boolean,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	ignoreSetup = false,
	skipSetup = false,
	steps?: Record<AgentPhaseName, ResolvedAgentStep>,
	quarantineDrift = false,
	deps?: Partial<OrchestratorDeps>,
	setupOutput?: SetupOutput,
): Promise<void> {
	if (sourceNames.length === 0) {
		throw new Error("At least one integration source is required.");
	}

	const sourceResolver =
		kind === "issues" ? resolveIssueIntegrationSource : resolveExistingIntegrationSource;
	const sources = sourceNames.map((sourceName) => sourceResolver(sourceName, allowUnreviewed));
	const manifest = createIntegrationManifest(name, kind, baseRef, sources, allowUnreviewed);
	await continueIntegration(
		manifest,
		model,
		effort,
		agentBackend,
		ignoreSetup,
		skipSetup,
		steps,
		quarantineDrift,
		deps,
		setupOutput,
	);
}

/**
 * Resume an in-flight integration from its persisted manifest (crash-safe continuation).
 *
 * @rejects {Error} When the manifest is missing or the integration is in a terminal state.
 */
export async function resumeIntegration(
	name: string,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	ignoreSetup = false,
	skipSetup = false,
	steps?: Record<AgentPhaseName, ResolvedAgentStep>,
	quarantineDrift = false,
	deps?: Partial<OrchestratorDeps>,
	setupOutput?: SetupOutput,
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

	await continueIntegration(
		manifest,
		model,
		effort,
		agentBackend,
		ignoreSetup,
		skipSetup,
		steps,
		quarantineDrift,
		deps,
		setupOutput,
	);
}

/** Print a human-readable summary of an integration's state. */
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

	if (manifest.drift !== undefined && manifest.drift.paths.length > 0) {
		// Older manifests predate `stashes`; their single commit is the whole history.
		const stashes =
			manifest.drift.stashes ??
			(manifest.drift.stashCommit === undefined || manifest.drift.stashCommit === ""
				? []
				: [manifest.drift.stashCommit]);
		const restore =
			stashes.length === 0
				? ""
				: ` (git stash apply ${stashes.join(", then ")} — oldest first)`;
		console.log(
			`Drift: ${manifest.drift.paths.length} path(s) quarantined at ${manifest.drift.stashedAt}${restore}`,
		);
		console.log(`  ${manifest.drift.paths.join(", ")}`);
	}

	if (manifest.lastError !== undefined && manifest.lastError !== "") {
		console.log(`Last error: ${manifest.lastError}`);
	}
}

/** Mark an integration aborted, preserving its worktree for inspection. */
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

/** Remove an integration worktree when it is clean (or forced), preserving the branch. */
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

		removeWorktree(worktree, { force });
	}

	manifest.status = "aborted";
	manifest.lastError = "Worktree cleaned up by operator; branch was preserved.";
	writeIntegrationManifest(manifest);
	console.log(`Cleaned up worktree for ${name}; branch ${manifest.branch} was preserved.`);
}

/**
 * - Drops an integration's worktree, branch, and manifest so it can be composed again.
 * - @param name - Integration name.
 * - @throws {Error} When no integration carries that name, or when the worktree cannot be removed.
 * - @remarks The member branches are untouched, so the composition is reproducible from scratch. The
 *   manifest is only rewritten when removal **fails**, and then with the true failure rather than
 *   the success message: claiming a reset that did not happen leaves the worktree, branch, and
 *   manifest on disk under a message that says they are gone, which is what made the original
 *   incident so hard to read. On success the manifest is deleted, so no intermediate state needs
 *   recording. Removing the manifest is what makes the next composition resolve its sources afresh
 *   instead of resuming the ones the stale manifest recorded.
 */
export function resetIntegration(name: string): void {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	manifest.status = "aborted";
	manifest.lastError = "Reset so the composition can be rebuilt from its sources.";

	const worktree = integrationBasePath(manifest);
	if (existsSync(worktree)) {
		try {
			removeWorktree(worktree, { force: true });
		} catch (err) {
			manifest.lastError = `Reset failed while removing the worktree: ${String(err)}`;
			writeIntegrationManifest(manifest);
			throw err;
		}
	}

	gitTry(["branch", "-D", manifest.branch]);
	rmSync(integrationManifestPath(name), { force: true });
	console.log(`Reset integration ${name}: worktree and branch ${manifest.branch} removed.`);
}

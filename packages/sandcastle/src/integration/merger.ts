/*
 * Merger adapter for integration composition.
 *
 * Owns the git merge contract for integrations: clean-resolution assertions
 * (`assertCleanMergeResolution`), drift handling (`prepareWorktreeForMerge`,
 * `quarantineWorktreeDrift`), and the per-source merge loop
 * (`integrateManifestSource`). Every git/inspection primitive flows through an
 * injectable `MergerDeps` seam so tests can exercise conflict, merge-in-progress,
 * and drift branches without a live repo.
 */

import {
	changedSinceMergeBase,
	git as defaultGit,
	gitTry as defaultGitTry,
	dirtyPaths,
	hasUnmergedPaths,
	isGitlink,
	mergeInProgress,
} from "../git.js";
import { config } from "../runtime.js";
import type {
	AgentBackend,
	IntegrationManifest,
	IntegrationSource,
	ResolvedAgentStep,
} from "../types.js";
import { integrationBasePath, writeIntegrationManifest } from "./manifest.js";

/**
 * - Subject for the merge commit that brings a source into the integration branch.
 * - @param source - Source name, e.g. `issue-409`.
 * - @returns The configured subject with `{source}` substituted.
 * - @remarks Conventional by default: a consumer with commitlint rejects a merge commit whose subject
 *   has no `type(scope)` prefix, and the rejected merge stays uncommitted, which the next resume
 *   then misreads as a conflict.
 */
export function mergeSubject(source: string): string {
	return config.integration.mergeSubject.replaceAll("{source}", source);
}

/**
 * - Hook flags for the commits sandcastle makes itself.
 * - @returns `--no-verify` unless the repository opted in with `integration.verifyHooks`.
 * - @remarks Repository hooks (commitlint, lint-staged) target human commits; a synthetic merge
 *   commit is not one, and a hook rejecting it leaves the composition half-finished.
 */
export function hookFlags(): Array<string> {
	return config.integration.verifyHooks ? [] : ["--no-verify"];
}

/** Best-effort `git merge --abort`, so a refused merge cannot be mistaken for a conflict. */
function abortMerge(worktree: string): void {
	defaultGitTry(["merge", "--abort"], worktree);
}

/** Name of the source whose merge is in flight; falls back to the integration name. */
function currentSourceName(manifest: IntegrationManifest): string {
	const source = manifest.sources[manifest.currentSource ?? 0];
	return source?.name ?? manifest.name;
}

/** Injectable git/inspection seam for integration merge operations. */
export interface MergerDeps {
	/** Best-effort `git merge --abort`; a refused merge must not survive as a phantom conflict. */
	abortMerge: (worktree: string) => void;
	changedSinceMergeBase: (worktree: string, commit: string) => Array<string>;
	dirtyPaths: (worktree: string) => Array<string>;
	git: (args: ReadonlyArray<string>, cwd?: string) => string;
	gitTry: (args: ReadonlyArray<string>, cwd?: string) => string | undefined;
	hasUnmergedPaths: (worktree: string) => boolean;
	isGitlink: (worktree: string, path: string) => boolean;
	mergeInProgress: (worktree: string) => boolean;
}

const defaultDeps: MergerDeps = {
	abortMerge,
	changedSinceMergeBase,
	dirtyPaths,
	git: defaultGit,
	gitTry: defaultGitTry,
	hasUnmergedPaths,
	isGitlink,
	mergeInProgress,
};

export function resolveMergerDeps(deps?: Partial<MergerDeps>): MergerDeps {
	return { ...defaultDeps, ...deps };
}

export function assertCleanMergeResolution(
	manifest: IntegrationManifest,
	deps: Partial<MergerDeps> = {},
): void {
	const merged = resolveMergerDeps(deps);
	const worktree = integrationBasePath(manifest);
	if (merged.hasUnmergedPaths(worktree)) {
		throw new Error(
			`Unmerged paths remain in ${worktree}; resolve every conflict before continuing.`,
		);
	}

	if (merged.mergeInProgress(worktree)) {
		merged.git(
			["commit", ...hookFlags(), "-m", mergeSubject(currentSourceName(manifest))],
			worktree,
		);
	}
}

/** Split tracked drift into merge-blocking paths and submodule pointers, which git merges over. */
export function partitionDrift(
	worktree: string,
	deps: Partial<MergerDeps> = {},
): { blocking: Array<string>; submodules: Array<string> } {
	const merged = resolveMergerDeps(deps);
	const drift = merged.dirtyPaths(worktree);
	const submodules = drift.filter((path) => merged.isGitlink(worktree, path));
	return { blocking: drift.filter((path) => !submodules.includes(path)), submodules };
}

/**
 * Stash uncommitted worktree changes so merges can proceed; the stash is recorded on the manifest.
 *
 * @remarks
 *   Accumulates onto any existing entry rather than replacing it. A composition can quarantine
 *   twice — once before a merge and again after the review — and each stash commit is the only
 *   pointer to the work it holds, so overwriting the slot silently lost the earlier one.
 */
export function quarantineWorktreeDrift(
	manifest: IntegrationManifest,
	worktree: string,
	paths: Array<string>,
	deps: Partial<MergerDeps> = {},
	manifestWriter: (manifest: IntegrationManifest) => void = writeIntegrationManifest,
): void {
	const merged = resolveMergerDeps(deps);
	const message = `sandcastle ${manifest.name}: pre-merge drift`;
	try {
		merged.git(["stash", "push", "-m", message, "--", ...paths], worktree);
	} catch (err) {
		throw new Error(
			`Could not quarantine uncommitted changes in ${worktree}: ${String(err)}\nResolve them manually before resuming.`,
		);
	}

	const stashCommit = merged.gitTry(["rev-parse", "--verify", "stash@{0}"], worktree);
	const previous = manifest.drift;
	const earlier = [...(previous?.stashes ?? []), previous?.stashCommit].filter(
		(commit): commit is string => commit !== undefined && commit !== "",
	);
	const stashes =
		stashCommit === undefined || stashCommit === "" ? earlier : [...earlier, stashCommit];
	manifest.drift = {
		paths: [...new Set([...(previous?.paths ?? []), ...paths])],
		stashCommit: stashes.at(-1),
		stashedAt: new Date().toISOString(),
		stashes,
	};
	if (manifestWriter !== undefined) {
		manifestWriter(manifest);
	}

	const stashSuffix = stashCommit === undefined || stashCommit === "" ? "" : `: ${stashCommit}`;
	console.log(
		`  ⤓ Quarantined ${paths.length} uncommitted path(s) before merging (${message})${stashSuffix}`,
	);

	const remaining = partitionDrift(worktree, deps).blocking;
	if (remaining.length > 0) {
		throw new Error(
			`Could not quarantine every uncommitted change in ${worktree}; still dirty: ${remaining.join(", ")}`,
		);
	}
}

/**
 * Refuse to merge over dirty tracked files.
 *
 * Git aborts such merges with "Your local changes would be overwritten by merge", which the
 * conflict resolver cannot fix, so the runner decides: fail with an actionable message, or stash
 * the drift when the operator passed `--quarantine-drift`.
 */
export function prepareWorktreeForMerge(
	manifest: IntegrationManifest,
	source: IntegrationSource,
	worktree: string,
	quarantineDrift: boolean,
	deps: Partial<MergerDeps> = {},
	manifestWriter: (manifest: IntegrationManifest) => void = writeIntegrationManifest,
): void {
	const merged = resolveMergerDeps(deps);
	const { blocking, submodules } = partitionDrift(worktree, deps);
	if (submodules.length > 0) {
		console.warn(
			`  ⚠ Submodule pointers are dirty but do not block the merge: ${submodules.join(", ")}`,
		);
	}

	if (blocking.length === 0) {
		return;
	}

	if (quarantineDrift) {
		quarantineWorktreeDrift(manifest, worktree, blocking, deps, manifestWriter);
		return;
	}

	const incoming = new Set(merged.changedSinceMergeBase(worktree, source.commit));
	const overlapping = blocking.filter((path) => incoming.has(path));
	if (overlapping.length > 0) {
		throw new Error(
			[
				`Integration worktree has uncommitted changes that merging ${source.name} would overwrite:`,
				...overlapping.map((path) => `  ${path}`),
				`Worktree: ${worktree}`,
				"Re-run with --quarantine-drift to stash them automatically, or resolve them yourself:",
				`  git -C "${worktree}" stash push -m 'sandcastle ${manifest.name}: pre-merge drift'`,
			].join("\n"),
		);
	}

	console.warn(
		`  ⚠ ${blocking.length} uncommitted path(s) are outside this merge but will block a later source.`,
	);
}

/** Seam for the agent that resolves a merge conflict on the integration worktree. */
export type ConflictResolverRunner = (
	manifest: IntegrationManifest,
	source: IntegrationSource,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	step?: ResolvedAgentStep,
) => Promise<void>;

export interface IntegrateSourceDeps extends Partial<MergerDeps> {
	runConflictResolver?: ConflictResolverRunner;
	writeIntegrationManifest?: (manifest: IntegrationManifest) => void;
}

export async function integrateManifestSource(
	manifest: IntegrationManifest,
	source: IntegrationSource,
	worktree: string,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	step?: ResolvedAgentStep,
	quarantineDrift = false,
	deps: IntegrateSourceDeps = {},
): Promise<void> {
	const merged = resolveMergerDeps(deps);
	const resolver =
		deps.runConflictResolver ??
		((async (...args: Parameters<ConflictResolverRunner>) => {
			const { runConflictResolver } = await import("./orchestrator.js");
			await runConflictResolver(...args);
		}) as ConflictResolverRunner);
	const manifestWriter =
		deps.writeIntegrationManifest ??
		((written: IntegrationManifest) => writeIntegrationManifest(written));

	if (
		merged.gitTry(["merge-base", "--is-ancestor", source.commit, "HEAD"], worktree) !==
		undefined
	) {
		return;
	}

	prepareWorktreeForMerge(manifest, source, worktree, quarantineDrift, deps, manifestWriter);

	if (merged.mergeInProgress(worktree)) {
		manifest.status = "conflict-resolution-required";
		manifest.lastError = `Conflict resolution is still required for ${source.name}.`;
		manifestWriter(manifest);
		if (resolver !== undefined) {
			await resolver(manifest, source, model, effort, agentBackend, step);
		}

		assertCleanMergeResolution(manifest, deps);
		return;
	}

	try {
		merged.git(
			["merge", "--no-ff", ...hookFlags(), source.commit, "-m", mergeSubject(source.name)],
			worktree,
		);
	} catch (err) {
		if (!merged.hasUnmergedPaths(worktree)) {
			/*
			 * No conflicts: git itself refused to create the merge commit — a commit hook rejecting the
			 * message, most often. Leaving MERGE_HEAD behind would make the next resume read as a conflict
			 * and hand a conflict-free merge to the resolver, so abandon the merge here and record what
			 * actually failed.
			 */
			if (merged.mergeInProgress(worktree)) {
				merged.abortMerge(worktree);
				manifest.status = "blocked";
				manifest.lastError = `Could not create the merge commit for ${source.name}: ${String(err)}`;
				manifestWriter(manifest);
			}

			throw err;
		}

		manifest.status = "conflict-resolution-required";
		manifest.lastError = `Conflict while integrating ${source.name}: ${String(err)}`;
		manifestWriter(manifest);
		console.error(
			`  Conflict while integrating ${source.name}; invoking resolving-merge-conflicts.`,
		);
		if (resolver !== undefined) {
			await resolver(manifest, source, model, effort, agentBackend, step);
		}

		assertCleanMergeResolution(manifest, deps);
	}
}

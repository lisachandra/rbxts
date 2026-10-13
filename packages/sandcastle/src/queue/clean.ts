/*
 * `queue clean`: prune the disposable half of the runner's state.
 *
 * Issue and integration worktrees accumulate forever: nothing else in the command group removes
 * `.sandcastle/worktrees/sandcastle-issue-<n>`, and `queue prune` / `queue land --finish` only touch
 * the manifest. This is the one place that answers "what is safe to delete?", and it answers from live
 * GitHub state plus the queue manifest rather than from file timestamps.
 *
 * Two invariants make deletion safe:
 * - A branch is the durable artifact and a worktree is disposable, so a member whose review is
 *   APPROVED is skipped on a re-fire even with its worktree gone (`sequential.ts` restores it). Only
 *   `--drop-branch` gives that up.
 * - An issue that is still open and unapproved may yet run, so its worktree is kept and reported
 *   instead of removed. Cleaning is never a way to cancel work by accident.
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import type { CliOptions } from "../cli.js";
import {
	dirtyPaths,
	gitTry,
	issueBranch,
	mergeInProgress,
	type RegisteredWorktree,
	registeredWorktrees,
} from "../git.js";
import { integrationWorktreePath, readIntegrationManifest } from "../integration/manifest.js";
import { resetIntegration } from "../integration/orchestrator.js";
import { config, integrationsDir } from "../runtime.js";
import { getLatestReviewMarker, isIssueComplete } from "../state.js";
import { removeWorktree, worktreePathForBranch } from "../worktree.js";
import { fetchLiveQueueState, type LiveQueueState } from "./live.js";
import {
	locateIssue,
	type QueueManifest,
	readQueueManifest,
	referencedIssues,
} from "./manifest.js";
import { emitJson, emitText } from "./output.js";

/** One issue worktree selected for removal. */
export interface IssueWorktreeCandidate {
	batch: string | undefined;
	issue: string;
	path: string;
	/** Why it was selected, e.g. "closed" or "review APPROVED". */
	reason: string;
}

/** One integration worktree selected for removal. */
export interface IntegrationCandidate {
	name: string;
	path: string;
	reason: string;
	/** `--reset` asked for the branch and manifest to go too, not just the worktree. */
	reset: boolean;
}

/** One worktree deliberately kept, with why. */
export interface KeptWorktree {
	path: string;
	reason: string;
}

/** What `queue clean` would do, or did. */
export interface CleanPlan {
	integrations: Array<IntegrationCandidate>;
	issueWorktrees: Array<IssueWorktreeCandidate>;
	kept: Array<KeptWorktree>;
}

/** Which selections the invocation asked for. */
export interface CleanSelections {
	all: boolean;
	closed: boolean;
	dropBranch: boolean;
	integrations: boolean;
	landed: boolean;
	reset: boolean;
	stale: boolean;
}

/** Terminal integration statuses: nothing more will be composed, so the worktree is disposable. */
const terminalIntegrationStatuses: ReadonlySet<string> = new Set([
	"aborted",
	"ready-for-human-merge",
]);

/**
 * - Whether two paths name the same worktree.
 * - @param left - First path, e.g. from `worktreePathForBranch`.
 * - @param right - Second path, e.g. as `git worktree list` printed it.
 * - @returns True when both resolve to the same directory.
 * - @remarks Git prints `D:/a/b` and node prints `D:\a\b` on Windows, so a raw string comparison
 *   would keep every worktree and make cleaning a silent no-op.
 */
function samePath(left: string, right: string): boolean {
	const a = pathResolve(left);
	const b = pathResolve(right);
	return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The issue number of a `sandcastle/issue-<n>` branch, or `undefined` for anything else. */
function issueOfWorktree(branch: string | undefined): string | undefined {
	if (branch === undefined) {
		return undefined;
	}

	return /^sandcastle\/issue-(\d+)$/u.exec(branch)?.[1];
}

/** Why a member's worktree is safe to remove, or `undefined` when it must be kept. */
function removalReason(params: {
	closed: boolean;
	landed: boolean;
	selections: CleanSelections;
	stale: boolean;
}): string | undefined {
	const { closed, landed, selections, stale } = params;
	if (selections.closed && closed) {
		return "closed";
	}

	if (selections.landed && landed) {
		return "review APPROVED";
	}

	if (selections.stale && stale) {
		return "not in the queue manifest";
	}

	return undefined;
}

/**
 * - Selects issue worktrees that are safe to remove.
 * - @param params - Live GitHub state, the queue manifest, registered worktrees, and selections.
 * - @returns The candidates to remove plus everything kept and why.
 * - @remarks Only `sandcastle/issue-<n>` branches whose registered path is this repository's own
 *   worktree path are considered, so a hand-made worktree is never a candidate. An issue that is
 *   still open and not approved is kept: it may yet run.
 */
export function selectIssueWorktrees(params: {
	live: LiveQueueState;
	manifest: QueueManifest;
	selections: CleanSelections;
	worktrees: ReadonlyArray<RegisteredWorktree>;
}): { kept: Array<KeptWorktree>; remove: Array<IssueWorktreeCandidate> } {
	const { live, manifest, selections, worktrees } = params;
	const remove: Array<IssueWorktreeCandidate> = [];
	const kept: Array<KeptWorktree> = [];

	for (const worktree of worktrees) {
		const issue = issueOfWorktree(worktree.branch);
		if (issue === undefined) {
			continue;
		}

		// Never the primary checkout, never a foreign path: only this repo's worktree directory.
		if (!samePath(worktreePathForBranch(worktree.branch ?? ""), worktree.path)) {
			kept.push({ path: worktree.path, reason: "not a runner-managed worktree path" });
			continue;
		}

		const state = live.issues.get(issue);
		const placement = locateIssue(manifest, issue);
		const reason = removalReason({
			closed: state?.state === "CLOSED",
			landed: isIssueComplete(issue) && getLatestReviewMarker(issue) === "APPROVED",
			selections,
			stale: placement === undefined && state === undefined,
		});
		if (reason === undefined) {
			kept.push({ path: worktree.path, reason: "still open and not approved" });
			continue;
		}

		remove.push({
			batch: placement?.kind === "sequence" ? placement.name : undefined,
			issue,
			path: worktree.path,
			reason,
		});
	}

	return { kept, remove };
}

/**
 * - Selects integration worktrees whose composition is finished with.
 * - @param params - Integration names present on disk, selections, and the manifest reader seam.
 * - @returns The candidates to remove plus everything kept and why.
 * - @remarks Only terminal statuses are candidates: a composition still in flight is resumable, so
 *   removing its worktree would destroy work rather than tidy it.
 */
export function selectIntegrations(params: {
	names: ReadonlyArray<string>;
	readManifest?: (name: string) => undefined | { status: string };
	selections: CleanSelections;
}): { kept: Array<KeptWorktree>; remove: Array<IntegrationCandidate> } {
	const read = params.readManifest ?? ((name: string) => readIntegrationManifest(name));
	const remove: Array<IntegrationCandidate> = [];
	const kept: Array<KeptWorktree> = [];
	if (!params.selections.integrations) {
		return { kept, remove };
	}

	for (const name of params.names) {
		const manifest = read(name);
		if (manifest === undefined) {
			kept.push({ path: name, reason: "no integration manifest" });
			continue;
		}

		const path = integrationWorktreePath(name);
		if (!terminalIntegrationStatuses.has(manifest.status)) {
			kept.push({ path, reason: `composition is ${manifest.status}` });
			continue;
		}

		remove.push({
			name,
			path,
			reason: `composition is ${manifest.status}`,
			reset: params.selections.reset,
		});
	}

	return { kept, remove };
}

/** Integration names that have a directory under the integrations dir. */
function integrationNamesOnDisk(): Array<string> {
	if (!existsSync(integrationsDir)) {
		return [];
	}

	try {
		return readdirSync(integrationsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

/** Refuses to remove a worktree that is dirty or mid-merge, unless `--force`. */
function removable(path: string, force: boolean): string | undefined {
	if (!existsSync(path)) {
		return undefined;
	}

	if (mergeInProgress(path)) {
		return "merge in progress";
	}

	const dirty = dirtyPaths(path);
	return dirty.length === 0 || force ? undefined : `dirty (${dirty.length} path(s))`;
}

/** Removes one issue worktree, returning the line to report. */
function removeIssueWorktree(
	options: CliOptions,
	candidate: IssueWorktreeCandidate,
	selections: CleanSelections,
): string {
	const blocked = removable(candidate.path, options.force === true);
	if (blocked !== undefined) {
		return `  ⏭ Kept #${candidate.issue}: ${blocked}; pass --force to remove it anyway.`;
	}

	removeWorktree(candidate.path, { force: true });
	const branch = issueBranch(candidate.issue);
	const dropped =
		selections.dropBranch && gitTry(["branch", "-D", branch]) !== undefined
			? ` and branch ${branch}`
			: "";
	return `  ⌫ Removed #${candidate.issue} worktree (${candidate.reason})${dropped}`;
}

/**
 * - Runs `queue clean`: reports, then removes, the worktrees the selections allow.
 * - @param options - Parsed CLI options; `--dry-run` reports without removing anything.
 * - @remarks Read-only under `--dry-run`, and never removes a worktree that is dirty, mid-merge, or
 *   still needed. Manifest writes go through `transactQueueManifest`, so `queue.commit` still
 *   applies.
 */
export function runQueueClean(options: CliOptions): void {
	const selections: CleanSelections = {
		all: options.cleanAll === true,
		closed: options.queueClosed === true || options.cleanAll === true,
		dropBranch: options.cleanDropBranch === true,
		integrations: options.cleanIntegrations === true || options.cleanAll === true,
		landed: options.cleanLanded === true || options.cleanAll === true,
		reset: options.cleanReset === true,
		stale: options.cleanStale === true || options.cleanAll === true,
	};

	const manifest = readQueueManifest();
	const live = fetchLiveQueueState({
		numbers: referencedIssues(manifest),
		readyLabel: config.labels.readyForAgent,
	});
	const worktrees = registeredWorktrees();

	const issue = selectIssueWorktrees({ live, manifest, selections, worktrees });
	const integrations = selections.integrations
		? selectIntegrations({ names: integrationNamesOnDisk(), selections })
		: { kept: [], remove: [] };

	const plan: CleanPlan = {
		integrations: integrations.remove,
		issueWorktrees: issue.remove,
		kept: [...issue.kept, ...integrations.kept],
	};

	if (options.jsonOut) {
		emitJson(plan);
	} else {
		emitText(
			options,
			`  Plan: ${String(plan.issueWorktrees.length)} issue worktree(s), ${String(plan.integrations.length)} integration(s)`,
		);
		for (const candidate of plan.issueWorktrees) {
			emitText(
				options,
				`    ⌫ #${candidate.issue} (${candidate.reason}) — ${candidate.path}`,
			);
		}

		for (const candidate of plan.integrations) {
			emitText(options, `    ⌫ ${candidate.name} (${candidate.reason})`);
		}

		for (const entry of plan.kept) {
			emitText(options, `    ⏭ kept ${entry.path}: ${entry.reason}`);
		}
	}

	if (options.dryRun) {
		emitText(options, "  (dry run — nothing removed)");
		return;
	}

	for (const candidate of plan.issueWorktrees) {
		emitText(options, removeIssueWorktree(options, candidate, selections));
	}

	for (const candidate of plan.integrations) {
		if (candidate.reset) {
			resetIntegration(candidate.name);
			emitText(
				options,
				`  ⌫ Reset integration ${candidate.name} (worktree, branch, manifest)`,
			);
		} else {
			const blocked = removable(candidate.path, options.force === true);
			if (blocked === undefined) {
				removeWorktree(candidate.path, { force: true });
				emitText(options, `  ⌫ Removed the ${candidate.name} integration worktree`);
			} else {
				emitText(
					options,
					`  ⏭ Kept ${candidate.name}: ${blocked}; pass --force to remove it anyway.`,
				);
			}
		}
	}

	emitText(
		options,
		`  ✓ Cleaned ${String(plan.issueWorktrees.length + plan.integrations.length)} worktree(s).`,
	);
}

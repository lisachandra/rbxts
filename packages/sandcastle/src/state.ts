/*
 * Persisted per-issue phase state and review markers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { issueView } from "./agent.js";
import { escapeRegExp } from "./config.js";
import { countBranchCommits } from "./git.js";
import { config, io, repoRoot, stateDir } from "./runtime.js";
import type { PhaseName, PhaseState, PhaseStatus } from "./types.js";

const statePath = (issue: string): string => pathResolve(stateDir, `${issue}.json`);

export function readState(issue: string): undefined | PhaseState {
	const p = statePath(issue);
	if (!existsSync(p)) {
		return undefined;
	}

	try {
		return JSON.parse(readFileSync(p, "utf-8")) as PhaseState;
	} catch {
		return undefined;
	}
}

export function writeState(state: PhaseState): void {
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(statePath(state.issue), `${JSON.stringify(state, undefined, 2)}\n`, "utf-8");
}

export function updatePhase(
	state: PhaseState,
	phase: PhaseName,
	status: PhaseStatus,
	extra?: Record<string, unknown>,
): void {
	state.phases[phase] = { extra, status, timestamp: new Date().toISOString() };
	writeState(state);
}

/** Commit SHAs recorded on a state's implement phase; empty when none were recorded. */
export function recordedCommits(state: undefined | PhaseState): Array<string> {
	const commits = state?.phases.implement.extra?.commits;
	return Array.isArray(commits)
		? commits.filter((sha): sha is string => typeof sha === "string")
		: [];
}

/**
 * - Recorded implement commits, combined with the ones a fresh run just made.
 * - @param recorded - SHAs already on the state.
 * - @param observed - SHAs the run that just finished produced.
 * - @returns The union, recorded first and deduplicated.
 * - @remarks The sandbox reports only the commits made _during that run_, so an implement re-run that
 *   changes nothing reports none. Replacing the recorded list would erase the evidence of the run
 *   that did the work, and {@link isIssueComplete} would then report a finished issue as
 *   unfinished.
 */
export function unionCommits(
	recorded: ReadonlyArray<string>,
	observed: ReadonlyArray<string>,
): Array<string> {
	return [...new Set([...recorded, ...observed])];
}

/** Whether the issue's branch carries commits the base it was cut from does not reach. */
function branchHasCommits(state: PhaseState): boolean {
	const base = state.base?.ref;
	if (base === undefined || base === "") {
		return false;
	}

	return countBranchCommits(state.branch, base) > 0;
}

/**
 * - Whether the review phase reached a satisfied, terminal outcome.
 * - @param state - Persisted phase state, or `undefined` when there is none.
 * - @returns True for a completed review, or a review skipped because there was nothing to review.
 * - @remarks `skipped` is the fresh-state initial value for every phase, so it cannot be accepted on
 *   its own: a run that died between implement and review would then read as reviewed. Only a skip
 *   that recorded `noCommits` is terminal, which is the one case where review had nothing to look
 *   at — a member whose implementation produced no commits of its own. Without this, such a member
 *   could never be complete, and every `queue run` would re-run it and fail the batch at hand-off.
 */
export function isReviewComplete(state: undefined | PhaseState): boolean {
	const review = state?.phases.review;
	if (review === undefined) {
		return false;
	}

	return (
		review.status === "done" ||
		(review.status === "skipped" && review.extra?.noCommits === true)
	);
}

/**
 * - Whether every phase finished and the work is actually on the issue's branch.
 * - @param issueNumber - Issue number.
 * - @returns True when design, implement, and review are all done and the branch carries commits.
 * - @remarks The branch is the durable evidence. A phase re-run whose agent changed nothing records
 *   an empty commit list over a branch that is full of work, so the recorded list is only trusted
 *   when it is non-empty and git answers for it otherwise. That keeps this in step with the phase
 *   evaluator, which counts the same thing the same way.
 */
export function isIssueComplete(issueNumber: string): boolean {
	const state = readState(issueNumber);
	if (state === undefined) {
		return false;
	}

	if (
		state.phases.design.status !== "done" ||
		state.phases.implement.status !== "done" ||
		!isReviewComplete(state)
	) {
		return false;
	}

	return recordedCommits(state).length > 0 || branchHasCommits(state);
}

export type ReviewMarker = "BLOCKED" | "APPROVED";

export function getLatestReviewMarker(issueNumber: string): undefined | ReviewMarker {
	const output = io
		.execSync(`${issueView(issueNumber)} --json comments`, {
			cwd: repoRoot,
			encoding: "utf-8",
		})
		.toString();
	const data = JSON.parse(output) as { comments?: Array<{ body?: string }> };
	const markers: Array<ReviewMarker> = (data.comments ?? []).flatMap((comment) => {
		const markerPattern = new RegExp(
			`^\\s*${escapeRegExp(config.reviewMarker)}\\s*:\\s*(APPROVED|BLOCKED)\\s*$`,
			"gim",
		);
		const matches = [...(comment.body ?? "").matchAll(markerPattern)];
		return matches.flatMap((match) => {
			const marker = match[1]?.toUpperCase();
			return marker === "APPROVED" || marker === "BLOCKED" ? [marker] : [];
		});
	});
	return markers.at(-1);
}

export function isIssueBlocked(issueNumber: string): boolean {
	return getLatestReviewMarker(issueNumber) === "BLOCKED";
}

/*
 * Persisted per-issue phase state and review markers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { issueView } from "./agent.js";
import { escapeRegExp } from "./config.js";
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

/**
 * Checks if a review ended with "blocked" status by looking at review comments. Returns true if the
 * issue review concluded with "blocked" status.
 */
export function isIssueComplete(issueNumber: string): boolean {
	const state = readState(issueNumber);
	return (
		state?.phases.design.status === "done" &&
		state.phases.implement.status === "done" &&
		state.phases.review.status === "done" &&
		((state.phases.implement.extra?.commits as undefined | Array<string>)?.length ?? 0) > 0
	);
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

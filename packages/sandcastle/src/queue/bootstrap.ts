/*
 * Queue bootstrap: a pure proposal for placing a repository's ready backlog.
 *
 * A repository that has never had a manifest cannot satisfy `queue check` — every open
 * `ready-for-agent` issue counts as drift — and a review has no batch to register follow-ups into.
 * The proposal groups the backlog by the conventional scope in each title (the same scope
 * vocabulary the issue tracker uses), leaves `wayfinder:*` tickets to a human session, and gates
 * anything with an open blocker.
 */

import type { LiveQueueState } from "./live.js";
import type { QueueEntry, QueueManifest, QueueSequence } from "./manifest.js";

export interface BootstrapParams {
	live: LiveQueueState;
	manifest: QueueManifest;
	/** Notes stamped onto every proposed sequence. */
	notes?: string;
}

export interface BootstrapProposal {
	gated: Array<QueueEntry>;
	/** `wayfinder:*` tickets, which are human decision sessions, never agent runs. */
	human: Array<QueueEntry>;
	sequences: Array<QueueSequence>;
}

const scopePattern = /^[a-z]+\(([^)]+)\):/u;

/**
 * - Conventional-commit scope of an issue title.
 * - @param title - Issue title, e.g. `feat(sandcastle): add the queue command group`.
 * - @returns The scope (`sandcastle`), or `unscoped` when the title carries none.
 */
export function scopeOf(title: string): string {
	const match = scopePattern.exec(title.trim().toLowerCase());
	return match?.[1] ?? "unscoped";
}

function placedIssues(manifest: QueueManifest): ReadonlySet<string> {
	const numbers = new Set<string>();
	for (const sequence of manifest.sequences) {
		for (const issue of sequence.issues) {
			numbers.add(issue);
		}
	}

	for (const entry of [...manifest.gated, ...manifest.human]) {
		numbers.add(entry.issue);
	}

	return numbers;
}

function blockReason(blockers: ReadonlyArray<string>): string {
	const numbers = blockers.map((blocker) => `#${blocker}`).join(", ");
	return `blocked by open ${numbers}`;
}

/**
 * - Proposes queue placements for every unplaced open `ready-for-agent` issue.
 * - @param params - Live GitHub state and the current manifest.
 * - @returns Sequences per conventional scope, plus gate and human entries.
 * - @remarks Pure and deterministic: ordering is by scope name, then issue number, so the proposal is
 *   stable enough to diff. Scopes that already have a sequence are skipped rather than merged.
 */
export function proposeBootstrap(params: BootstrapParams): BootstrapProposal {
	const placed = placedIssues(params.manifest);
	const existing = new Set(params.manifest.sequences.map((sequence) => sequence.name));
	const byScope = new Map<string, Array<string>>();
	const gated: Array<QueueEntry> = [];
	const human: Array<QueueEntry> = [];

	for (const ready of params.live.readyIssues) {
		if (placed.has(ready.number)) {
			continue;
		}

		const issue = params.live.issues.get(ready.number);
		if (issue?.wayfinder === true) {
			human.push({
				issue: ready.number,
				reason: "wayfinder ticket — human decision session",
			});
			continue;
		}

		const blockers = issue?.openBlockers ?? [];
		if (blockers.length > 0) {
			gated.push({ issue: ready.number, reason: blockReason(blockers) });
			continue;
		}

		const scope = scopeOf(ready.title);
		if (existing.has(scope)) {
			continue;
		}

		const bucket = byScope.get(scope) ?? [];
		bucket.push(ready.number);
		byScope.set(scope, bucket);
	}

	const sequences: Array<QueueSequence> = [...byScope]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([scope, issues]) => ({
			issues: [...issues].sort((left, right) => Number(left) - Number(right)),
			name: scope,
			notes: params.notes ?? "bootstrap proposal",
		}));

	return { gated, human, sequences };
}

/** Merges a proposal into the manifest — the write behind `queue bootstrap --apply`. */
export function applyBootstrap(
	manifest: QueueManifest,
	proposal: BootstrapProposal,
): QueueManifest {
	return {
		...manifest,
		gated: [...manifest.gated, ...proposal.gated],
		human: [...manifest.human, ...proposal.human],
		sequences: [...manifest.sequences, ...proposal.sequences],
	};
}

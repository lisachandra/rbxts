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
import { promoteIssue } from "./mutations.js";

export interface BootstrapParams {
	live: LiveQueueState;
	manifest: QueueManifest;
	/** Notes stamped onto every proposed sequence. */
	notes?: string;
}

export interface BootstrapPromotion {
	issue: string;
	/** Sequence the promoted issue joins: the conventional scope of its title. */
	sequence: string;
}

export interface BootstrapProposal {
	gated: Array<QueueEntry>;
	/** `wayfinder:*` tickets, which are human decision sessions, never agent runs. */
	human: Array<QueueEntry>;
	/** Gated issues whose conditions have since resolved. */
	promotions: Array<BootstrapPromotion>;
	sequences: Array<QueueSequence>;
}

/**
 * - Gated issues whose blocking conditions have resolved.
 * - @param params - Live GitHub state and the current manifest.
 * - @returns One promotion per gate that is open, `ready-for-agent`, and has no open blocker.
 * - @remarks This is the other half of the gate dead end: before it, a gate could only ever be
 *   cleared by hand, so `bootstrap` skipped gated entries forever. `wayfinder:*` gates are left
 *   alone - they need a human session, not a sequence.
 */
export function promotableGates(params: BootstrapParams): Array<BootstrapPromotion> {
	const promotions: Array<BootstrapPromotion> = [];
	for (const entry of params.manifest.gated) {
		const issue = params.live.issues.get(entry.issue);
		if (issue === undefined || !issue.found || issue.state !== "OPEN") {
			continue;
		}

		if (!issue.ready || issue.openBlockers.length > 0 || issue.wayfinder) {
			continue;
		}

		promotions.push({
			issue: entry.issue,
			sequence: entry.joins ?? batchNameForScope(scopeOf(issue.title)),
		});
	}

	return promotions;
}

const scopePattern = /^[a-z]+\(([^)]+)\):/u;

/** Suffix every bootstrap-proposed batch name carries. */
const workSuffix = "-work";

/**
 * - Conventional-commit scope of an issue title.
 * - @param title - Issue title, e.g. `feat(sandcastle): add the queue command group`.
 * - @returns The scope (`sandcastle`), or `unscoped` when the title carries none.
 */
export function scopeOf(title: string): string {
	const match = scopePattern.exec(title.trim().toLowerCase());
	return match?.[1] ?? "unscoped";
}

/**
 * - Integration name a scope's batch gets by default.
 * - @param scope - Conventional-commit scope, as returned by {@link scopeOf}.
 * - @returns The scope plus `-work`, e.g. `vfx-mounts-work`.
 * - @remarks A batch name IS an integration name, so it has to read as one:
 *   `sandcastle/integration/<name>`. The suffix keeps batch names from colliding with the branch
 *   names of the issues inside them.
 */
export function batchNameForScope(scope: string): string {
	return scope.endsWith(workSuffix) ? scope : `${scope}${workSuffix}`;
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
		const name = batchNameForScope(scope);
		if (existing.has(name)) {
			continue;
		}

		const bucket = byScope.get(name) ?? [];
		bucket.push(ready.number);
		byScope.set(name, bucket);
	}

	const sequences: Array<QueueSequence> = [...byScope]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([scope, issues]) => ({
			issues: [...issues].sort((left, right) => Number(left) - Number(right)),
			name: scope,
			notes: params.notes ?? "bootstrap proposal",
		}));

	return { gated, human, promotions: promotableGates(params), sequences };
}

/** Merges a proposal into the manifest — the write behind `queue bootstrap --apply`. */
export function applyBootstrap(
	manifest: QueueManifest,
	proposal: BootstrapProposal,
): QueueManifest {
	const merged: QueueManifest = {
		...manifest,
		gated: [...manifest.gated, ...proposal.gated],
		human: [...manifest.human, ...proposal.human],
		sequences: [...manifest.sequences, ...proposal.sequences],
	};

	let next = merged;
	for (const promotion of proposal.promotions) {
		next = promoteIssue(next, promotion);
	}

	return next;
}

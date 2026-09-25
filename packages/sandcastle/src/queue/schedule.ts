/*
 * Queue scheduling: the pure decision that turns a live view into the next batch to fire.
 *
 * The dispatcher (`queue run`) owns the I/O — reading the manifest, fetching live GitHub state, and
 * running the batch — while everything testable about *what to run next* lives here. Sequences are
 * the only runnable unit: gates are decisions the queue is still waiting on, and a serialization
 * rule (`R<n>`) is the repo's own statement that two issues must never be in flight together.
 */

import type { QueueManifest } from "./manifest.js";
import type { QueueView } from "./render.js";

export interface ScheduleParams {
	/** Restrict dispatch to this sequence name (`queue run --name <batch>`). */
	batch?: string;
	manifest: QueueManifest;
	/** Issues already dispatched by this run. */
	seen: ReadonlySet<string>;
	view: QueueView;
}

export type ScheduleDecision =
	| { kind: "done"; reason: string }
	| { issues: Array<string>; kind: "sequence"; name: string };

/**
 * Members of `candidate` that a serialization rule keeps apart from an already-dispatched issue.
 *
 * @param manifest - Manifest holding the `R<n>` rules.
 * @param candidate - Issue numbers of the sequence being considered.
 * @param seen - Issue numbers already dispatched in this run.
 * @returns The conflicting candidate numbers; empty when the sequence may fire.
 */
export function ruleConflicts(
	manifest: QueueManifest,
	candidate: ReadonlySet<string>,
	seen: ReadonlySet<string>,
): Array<string> {
	const conflicts = new Set<string>();
	for (const rule of manifest.serialized) {
		if (!rule.issues.some((issue) => seen.has(issue))) {
			continue;
		}

		for (const issue of rule.issues) {
			if (candidate.has(issue)) {
				conflicts.add(issue);
			}
		}
	}

	return [...conflicts];
}

/**
 * - Selects the next sequence to fire from a live queue view.
 * - @param params - Manifest, live view, batch filter, and the issues already dispatched this run.
 * - @returns The next sequence to run, or a rendered reason why nothing can run.
 * - @remarks Re-read the view between batches: a review that registered a follow-up, promoted a gate,
 *   or filed a new `ready-for-agent` issue changes what this returns on the next call.
 */
export function selectNextBatch(params: ScheduleParams): ScheduleDecision {
	const { batch, manifest, seen, view } = params;
	const filtered = batch !== undefined && batch !== "";
	if (filtered && !manifest.sequences.some((sequence) => sequence.name === batch)) {
		return { kind: "done", reason: `no sequence named "${batch}"` };
	}

	const reasons: Array<string> = [];
	for (const sequence of view.sequences) {
		if (filtered && sequence.name !== batch) {
			continue;
		}

		if (sequence.issues.every((issue) => seen.has(issue.number))) {
			continue;
		}

		if (sequence.status !== "READY") {
			reasons.push(`sequence "${sequence.name}" is GATED (${sequence.reasons.join("; ")})`);
			continue;
		}

		const members = new Set(sequence.issues.map((issue) => issue.number));
		const conflicts = ruleConflicts(manifest, members, seen);
		if (conflicts.length > 0) {
			reasons.push(
				`sequence "${sequence.name}" shares a serialization rule with dispatched ${conflicts
					.map((issue) => `#${issue}`)
					.join(", ")}`,
			);
			continue;
		}

		return {
			issues: sequence.issues.map((issue) => issue.number),
			kind: "sequence",
			name: sequence.name,
		};
	}

	return {
		kind: "done",
		reason: reasons.length > 0 ? reasons.join(" · ") : "no sequence is ready to fire",
	};
}

/** The tail issue of a sequence, i.e. what `sandcastle merge --issues` expects. */
export function sequenceTail(issues: ReadonlyArray<string>): string {
	return issues.at(-1) ?? "";
}

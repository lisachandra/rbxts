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
	/**
	 * Batch dispatched immediately before this call. While it still has members this run has not
	 * dispatched it wins over manifest order, because a batch that grew mid-run has not finished.
	 */
	preferred?: string;
	/** Issues already dispatched by this run. */
	seen: ReadonlySet<string>;
	view: QueueView;
}

export type ScheduleDecision =
	| { issues: Array<string>; kind: "sequence"; name: string }
	| {
			kind: "done";
			reason: string;
			/**
			 * True when every batch still in the manifest is waiting only because its members are
			 * already dispatched. That is full utilization, not an exhausted queue, and the two
			 * must not read the same in a run's report: one means "wait", the other means "go
			 * home".
			 */
			saturated?: boolean;
	  };

/**
 * Members of `candidate` that a serialization rule keeps apart from an already-dispatched issue.
 *
 * @remarks
 *   A rule whose dispatched issues are all members of `candidate` is the batch meeting itself, not
 *   a cross-batch conflict: `seen` holds them because _this_ batch dispatched them. Counting that
 *   made a batch conflict with its own membership for the rest of the invocation, so it could never
 *   re-fire when a review appended a follow-up mid-run.
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
		/*
		 * A serialization rule states that two batches must never be in flight together. A batch
		 * meeting its own already-dispatched members is not that: `seen` holds them because this batch
		 * dispatched them, so counting the rule would stop the batch from ever re-firing.
		 */
		const dispatchedElsewhere = rule.issues.some(
			(issue) => seen.has(issue) && !candidate.has(issue),
		);
		if (!dispatchedElsewhere) {
			continue;
		}

		for (const issue of rule.issues) {
			// Already-dispatched members are not re-dispatched, so only unseen ones can conflict.
			if (candidate.has(issue) && !seen.has(issue)) {
				conflicts.add(issue);
			}
		}
	}

	return [...conflicts];
}

/**
 * - Selects the next sequence to fire from a live queue view.
 * - @param params - Manifest, live view, batch filter, the preferred batch, and the issues already
 *   dispatched this run.
 * - @returns The next sequence to run, or a rendered reason why nothing can run.
 * - @remarks Re-read the view between batches: a review that registered a follow-up, promoted a gate,
 *   or filed a new `ready-for-agent` issue changes what this returns on the next call.
 * - @remarks A batch that grew members while it ran is unfinished work, so it is tried before
 *   manifest order. When it cannot continue, the reason names that batch rather than silently
 *   falling through to an unrelated one - firing a different batch first is how a follow-up
 *   registered mid-run was passed over.
 */
export function selectNextBatch({
	batch,
	manifest,
	preferred,
	seen,
	view,
}: ScheduleParams): ScheduleDecision {
	const filtered = batch !== undefined && batch !== "";
	if (filtered && !manifest.sequences.some((sequence) => sequence.name === batch)) {
		return { kind: "done", reason: `no sequence named "${batch}"` };
	}

	/*
	 * A batch dispatched immediately before this call wins while members of it are still waiting to run: a
	 * review that registered a follow-up into it has not finished that work.
	 */
	if (!filtered && preferred !== undefined && preferred !== "") {
		const pending = pendingMembers(view, preferred, seen);
		if (pending.length > 0) {
			const stalled = stallReason(manifest, view, preferred, pending, seen);
			if (stalled !== undefined) {
				return { kind: "done", reason: stalled };
			}

			const candidate = view.sequences.find((sequence) => sequence.name === preferred);
			return {
				issues: (candidate?.issues ?? []).map((issue) => issue.number),
				kind: "sequence",
				name: preferred,
			};
		}
	}

	const reasons: Array<string> = [];
	/** Sequences skipped only because every member is already dispatched. */
	let inFlight = 0;
	for (const sequence of view.sequences) {
		if (filtered && sequence.name !== batch) {
			continue;
		}

		if (sequence.issues.length === 0) {
			reasons.push(`sequence "${sequence.name}" has no members`);
			continue;
		}

		if (sequence.issues.every((issue) => seen.has(issue.number))) {
			inFlight += 1;
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

	/*
	 * "Nothing is ready" and "everything is already running" are different reports. The first says the
	 * queue is exhausted or gated; the second says a dispatcher is at capacity and should wait. Only
	 * the second sets `saturated`, and only when nothing else is also pending: a gated batch beside an
	 * in-flight one is a queue with work to do later, not a full one.
	 */
	const saturated = reasons.length === 0 && inFlight > 0;
	return {
		kind: "done",
		reason: reasons.length > 0 ? reasons.join(" · ") : "no sequence is ready to fire",
		...(saturated ? { saturated: true } : {}),
	};
}

/** Members of a sequence that this run has not dispatched yet. */
export function pendingMembers(
	view: QueueView,
	name: string,
	seen: ReadonlySet<string>,
): Array<string> {
	const sequence = view.sequences.find((entry) => entry.name === name);
	return (sequence?.issues ?? [])
		.map((issue) => issue.number)
		.filter((issue) => !seen.has(issue));
}

/**
 * - Why a batch that grew mid-run cannot continue, or `undefined` when it can.
 * - @param manifest - Manifest holding the `R<n>` rules.
 * - @param view - Live queue view.
 * - @param name - The batch that was dispatched immediately before this call.
 * - @param pending - Members of it this run has not dispatched.
 * - @param seen - Issue numbers already dispatched in this run.
 * - @returns A reason naming the batch, or `undefined` when the batch may fire again.
 */
function stallReason(
	manifest: QueueManifest,
	view: QueueView,
	name: string,
	pending: ReadonlyArray<string>,
	seen: ReadonlySet<string>,
): string | undefined {
	const sequence = view.sequences.find((entry) => entry.name === name);
	const listed = pending.map((issue) => `#${issue}`).join(", ");
	if (sequence === undefined) {
		return `sequence "${name}" grew ${listed} mid-run but is no longer defined`;
	}

	if (sequence.status !== "READY") {
		return `sequence "${name}" grew ${listed} mid-run but is GATED (${sequence.reasons.join("; ")})`;
	}

	const members = new Set(sequence.issues.map((issue) => issue.number));
	const conflicts = ruleConflicts(manifest, members, seen);
	if (conflicts.length > 0) {
		return `sequence "${name}" grew ${listed} mid-run but shares a serialization rule with dispatched ${conflicts
			.map((issue) => `#${issue}`)
			.join(", ")}`;
	}

	return undefined;
}

/** The tail issue of a sequence, i.e. what `sandcastle merge --issues` expects. */
export function sequenceTail(issues: ReadonlyArray<string>): string {
	return issues.at(-1) ?? "";
}

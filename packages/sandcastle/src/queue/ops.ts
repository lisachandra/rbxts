/*
 * Queue mutations: the CLI wrappers, one manifest transaction each.
 *
 * A transaction owns the whole read → mutate → write cycle under the manifest lock, so two writers —
 * a review agent registering a follow-up inside a worktree and a human running `queue add` in
 * another terminal — cannot lose each other's changes. Message text is produced *inside* the
 * transaction because only it sees the manifest that was actually read: "Moved (was sequence "U2"
 * (position 2))" is placement history, and placement history is what makes a queue auditable.
 */

import type { CliOptions } from "../cli.js";
import { config } from "../runtime.js";
import { fetchLiveQueueState, type LiveQueueState } from "./live.js";
import {
	describePlacement,
	locateIssue,
	type QueueManifest,
	readQueueManifest,
	referencedIssues,
} from "./manifest.js";
import { addRule, addToSequence, defineSequence, placeIssue, removeIssue } from "./mutations.js";
import { transactQueueManifest } from "./persist.js";

function requireIssueNumber(options: CliOptions, subcommand: string): string {
	if (options.issueNumber === undefined || options.issueNumber === "") {
		throw new Error(`queue ${subcommand} requires --issue <number>`);
	}

	return options.issueNumber;
}

/** Places an issue into a batch, a gate, or the human bucket, reporting the move. */
export function runQueueAdd(options: CliOptions): void {
	const issue = requireIssueNumber(options, "add");
	transactQueueManifest(options, (manifest) => {
		const previous = locateIssue(manifest, issue);
		const next =
			options.queueSequence === undefined
				? placeIssue(manifest, {
						issue,
						reason: options.reason ?? "",
						target: options.queueBucket === "gated" ? "gated" : "human",
					})
				: addToSequence(manifest, {
						after: options.after,
						issue,
						sequence: options.queueSequence,
					});
		const where = describePlacement(locateIssue(next, issue) ?? { kind: "human" });
		const moved =
			previous === undefined ? "Placed" : `Moved (was ${describePlacement(previous)})`;
		return {
			message: `  ✓ ${moved} #${issue} → ${where}`,
			next,
			summary: `place #${issue} in the queue`,
		};
	});
}

/** Creates or replaces a batch definition. */
export function runQueueSequence(options: CliOptions): void {
	const name = options.integrationName ?? "";
	if (name === "") {
		throw new Error("queue sequence requires --name <batch-name>");
	}

	if (options.issueNumbers.length === 0) {
		throw new Error("queue sequence requires --issues <a,b,c>");
	}

	const memberCount = options.issueNumbers.length;
	transactQueueManifest(options, (manifest) => ({
		message: `  ✓ Defined sequence "${name}" (${memberCount} issue(s)): ${options.issueNumbers.join(", ")}`,
		next: defineSequence(manifest, {
			issues: options.issueNumbers,
			mergeName: options.mergeName,
			name,
			notes: options.notes,
		}),
		summary: `define sequence "${name}"`,
	}));
}

/** Adds or replaces a same-file serialization rule. */
export function runQueueRule(options: CliOptions): void {
	if (options.issueNumbers.length === 0) {
		throw new Error("queue rule requires --issues <a,b>");
	}

	if (options.reason === undefined || options.reason === "") {
		throw new Error("queue rule requires --reason");
	}

	const family = options.issueNumbers.join(", ");
	transactQueueManifest(options, (manifest) => ({
		message: `  ✓ Serialization rule for (${family}): ${options.reason ?? ""}`,
		next: addRule(manifest, {
			issues: options.issueNumbers,
			name: options.integrationName,
			reason: options.reason ?? "",
		}),
		summary: `add serialization rule for ${family}`,
	}));
}

/** Removes an issue from every placement. */
export function runQueueRemove(options: CliOptions): void {
	const issue = requireIssueNumber(options, "remove");
	transactQueueManifest(options, (manifest) => ({
		message: `  ✓ Removed #${issue} from the queue manifest`,
		next: removeIssue(manifest, issue),
		summary: `remove #${issue} from the queue`,
	}));
}

/** Removes an issue when it is placed, leaving the manifest untouched when it is not. */
function removeIfPlaced(manifest: QueueManifest, issue: string): QueueManifest {
	try {
		return removeIssue(manifest, issue);
	} catch {
		return manifest;
	}
}

/** Referenced CLOSED issues, excluding `human` entries — a finished decision session is a record. */
function closedIssues(manifest: QueueManifest, live: LiveQueueState): Array<string> {
	const human = new Set(manifest.human.map((entry) => entry.issue));
	return [...referencedIssues(manifest)].filter(
		(issue) => !human.has(issue) && live.issues.get(issue)?.state === "CLOSED",
	);
}

/**
 * - Drops references to CLOSED issues, which otherwise gate their batch forever.
 * - @param options - Parsed CLI options; `--closed` is required, `--dry-run` reports only.
 * - @remarks `human` entries are kept — a finished decision session is still a record — and
 *   referenced-but-missing issues are left as drift for a human to investigate. Live state is
 *   fetched before the lock so the critical section stays short; the closed set is recomputed from
 *   the manifest the transaction reads.
 */
export function runQueuePrune(options: CliOptions): void {
	const live = fetchLiveQueueState({
		numbers: referencedIssues(readQueueManifest()),
		readyLabel: config.labels.readyForAgent,
	});

	transactQueueManifest(options, (manifest) => {
		const closed = closedIssues(manifest, live);
		if (closed.length === 0) {
			return {
				message: "  ✓ Nothing to prune: no closed issues are referenced.",
				next: manifest,
				summary: "prune closed issues",
			};
		}

		let next = manifest;
		for (const issue of closed) {
			next = removeIfPlaced(next, issue);
		}

		return {
			message: `  ⌫ Pruned ${closed.length} closed issue(s): ${closed.join(", ")}`,
			next,
			summary: `prune ${closed.length} closed issue(s)`,
		};
	});
}

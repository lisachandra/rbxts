/*
 * Queue mutations: the CLI wrappers that read, mutate, and persist the manifest.
 *
 * Each wrapper keeps its own move message — placement history is what makes a queue auditable — and
 * pipes the result through `persistQueueManifest`, which owns where the file lives and whether the
 * write is committed.
 */

import type { CliOptions } from "../cli.js";
import {
	describePlacement,
	locateIssue,
	type QueueManifest,
	readQueueManifest,
} from "./manifest.js";
import { addRule, addToSequence, defineSequence, placeIssue, removeIssue } from "./mutations.js";
import { persistQueueManifest } from "./persist.js";

function requireIssueNumber(options: CliOptions, subcommand: string): string {
	if (options.issueNumber === undefined || options.issueNumber === "") {
		throw new Error(`queue ${subcommand} requires --issue <number>`);
	}

	return options.issueNumber;
}

/** Places an issue into a batch, a gate, or the human bucket, reporting the move. */
export function runQueueAdd(options: CliOptions): void {
	const issue = requireIssueNumber(options, "add");
	const manifest = readQueueManifest();
	const previous = locateIssue(manifest, issue);
	let next: QueueManifest;
	if (options.queueSequence !== undefined) {
		next = addToSequence(manifest, {
			after: options.after,
			issue,
			sequence: options.queueSequence,
		});
	} else if (options.queueBucket === "gated") {
		next = placeIssue(manifest, { issue, reason: options.reason ?? "", target: "gated" });
	} else {
		next = placeIssue(manifest, { issue, reason: options.reason ?? "", target: "human" });
	}

	persistQueueManifest(next, `place #${issue} in the queue`, options);
	const where = describePlacement(locateIssue(next, issue) ?? { kind: "human" });
	const moved = previous === undefined ? "Placed" : `Moved (was ${describePlacement(previous)})`;
	console.log(`  ✓ ${moved} #${issue} → ${where}`);
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

	const next = defineSequence(readQueueManifest(), {
		issues: options.issueNumbers,
		mergeName: options.mergeName,
		name,
		notes: options.notes,
	});
	persistQueueManifest(next, `define sequence "${name}"`, options);
	const memberCount = options.issueNumbers.length;
	console.log(
		`  ✓ Defined sequence "${name}" (${memberCount} issue(s)): ${options.issueNumbers.join(", ")}`,
	);
}

/** Adds or replaces a same-file serialization rule. */
export function runQueueRule(options: CliOptions): void {
	if (options.issueNumbers.length === 0) {
		throw new Error("queue rule requires --issues <a,b>");
	}

	if (options.reason === undefined || options.reason === "") {
		throw new Error("queue rule requires --reason");
	}

	const next = addRule(readQueueManifest(), {
		issues: options.issueNumbers,
		name: options.integrationName,
		reason: options.reason,
	});
	persistQueueManifest(
		next,
		`add serialization rule for ${options.issueNumbers.join(", ")}`,
		options,
	);
	console.log(
		`  ✓ Serialization rule for (${options.issueNumbers.join(", ")}): ${options.reason}`,
	);
}

/** Removes an issue from every placement. */
export function runQueueRemove(options: CliOptions): void {
	const issue = requireIssueNumber(options, "remove");
	const next = removeIssue(readQueueManifest(), issue);
	persistQueueManifest(next, `remove #${issue} from the queue`, options);
	console.log(`  ✓ Removed #${issue} from the queue manifest`);
}

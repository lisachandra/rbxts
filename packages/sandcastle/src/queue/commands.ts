/*
 * Queue command orchestration.
 *
 * Thin glue between the parsed CLI options and the queue modules: mutations
 * write the manifest (with helpful move messages), while list/check fetch live
 * GitHub state and render the view. `check` exits non-zero on drift so the
 * freshness pass is scriptable (advisory for agents today, CI-ready later).
 */

import type { CliOptions } from "../cli.js";
import { config, io } from "../runtime.js";
import { fetchLiveQueueState } from "./live.js";
import {
	describePlacement,
	locateIssue,
	type QueueManifest,
	readQueueManifest,
	referencedIssues,
	writeQueueManifest,
} from "./manifest.js";
import { addRule, addToSequence, defineSequence, placeIssue, removeIssue } from "./mutations.js";
import { computeQueueView, renderQueueText } from "./render.js";

export type QueueSubcommand = "add" | "list" | "rule" | "check" | "remove" | "sequence";

export const queueSubcommands: ReadonlyArray<QueueSubcommand> = [
	"add",
	"check",
	"list",
	"rule",
	"remove",
	"sequence",
];

const queueSubcommandSet: ReadonlySet<string> = new Set(queueSubcommands);

export function isQueueSubcommand(value: string | undefined): value is QueueSubcommand {
	return value !== undefined && queueSubcommandSet.has(value);
}

/** Runs the `sandcastle queue` command group. */
export function runQueueCommand(options: CliOptions): void {
	switch (options.queueSubcommand) {
		case "add": {
			runQueueAdd(options);
			break;
		}
		case "check": {
			runQueueCheck(options);
			break;
		}
		case "list": {
			runQueueList(options);
			break;
		}
		case "remove": {
			runQueueRemove(options);
			break;
		}
		case "rule": {
			runQueueRule(options);
			break;
		}
		case "sequence": {
			runQueueSequence(options);
			break;
		}
	}
}

function requireIssueNumber(options: CliOptions, subcommand: string): string {
	if (options.issueNumber === undefined || options.issueNumber === "") {
		throw new Error(`queue ${subcommand} requires --issue <number>`);
	}

	return options.issueNumber;
}

function runQueueAdd(options: CliOptions): void {
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

	writeQueueManifest(next);
	const where = describePlacement(locateIssue(next, issue) ?? { kind: "human" });
	const moved = previous === undefined ? "Placed" : `Moved (was ${describePlacement(previous)})`;
	console.log(`  ✓ ${moved} #${issue} → ${where}`);
}

function runQueueSequence(options: CliOptions): void {
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
	writeQueueManifest(next);
	console.log(
		`  ✓ Defined sequence "${name}" (${options.issueNumbers.length} issue(s)): ${options.issueNumbers.join(", ")}`,
	);
}

function runQueueRule(options: CliOptions): void {
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
	writeQueueManifest(next);
	console.log(
		`  ✓ Serialization rule for (${options.issueNumbers.join(", ")}): ${options.reason}`,
	);
}

function runQueueRemove(options: CliOptions): void {
	const issue = requireIssueNumber(options, "remove");
	const next = removeIssue(readQueueManifest(), issue);
	writeQueueManifest(next);
	console.log(`  ✓ Removed #${issue} from the queue manifest`);
}

function runQueueList(options: CliOptions): void {
	const manifest = readQueueManifest();
	const live = fetchLiveQueueState({
		numbers: referencedIssues(manifest),
		readyLabel: config.labels.readyForAgent,
	});
	const view = computeQueueView(manifest, live);
	if (options.jsonOut) {
		console.log(JSON.stringify(view, undefined, 2));
		return;
	}

	console.log(renderQueueText(view));
}

function runQueueCheck(options: CliOptions): void {
	const manifest = readQueueManifest();
	const live = fetchLiveQueueState({
		numbers: referencedIssues(manifest),
		readyLabel: config.labels.readyForAgent,
	});
	const view = computeQueueView(manifest, live);
	if (options.jsonOut) {
		console.log(JSON.stringify(view, undefined, 2));
	} else {
		console.log(renderQueueText(view));
	}

	if (view.drift.length > 0) {
		console.error(`  ✗ Queue drift: ${view.drift.length} problem(s). Resolve before firing.`);
		io.exit(1);
	}

	console.log("  ✓ No queue drift.");
}

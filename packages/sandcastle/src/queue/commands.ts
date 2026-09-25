/*
 * Queue command orchestration.
 *
 * Thin glue between the parsed CLI options and the queue modules. Reads (`list`, `check`) fetch live
 * GitHub state and render the view; mutations live in `ops.ts`; dispatch lives in `run.ts`. `check`
 * exits 1 on drift and 2 when `--strict-gates` finds a stale gate, so the freshness pass is
 * scriptable while a stale gate stays a distinct failure.
 */

import type { CliOptions } from "../cli.js";
import { config, io } from "../runtime.js";
import { fetchLiveQueueState } from "./live.js";
import { readQueueManifest, referencedIssues } from "./manifest.js";
import {
	runQueueAdd,
	runQueuePrune,
	runQueuePromote,
	runQueueRemove,
	runQueueRule,
	runQueueSequence,
} from "./ops.js";
import { computeQueueView, type QueueView, renderQueueText } from "./render.js";
import { runQueueBootstrap, runQueueRun } from "./run.js";

export type QueueSubcommand =
	| "add"
	| "run"
	| "list"
	| "rule"
	| "check"
	| "prune"
	| "promote"
	| "remove"
	| "sequence"
	| "bootstrap";

export const queueSubcommands: ReadonlyArray<QueueSubcommand> = [
	"add",
	"bootstrap",
	"check",
	"list",
	"prune",
	"promote",
	"remove",
	"rule",
	"run",
	"sequence",
];

const queueSubcommandSet: ReadonlySet<string> = new Set(queueSubcommands);

export function isQueueSubcommand(value: string | undefined): value is QueueSubcommand {
	return value !== undefined && queueSubcommandSet.has(value);
}

/** Queue subcommands that change the manifest and therefore refuse to run while disabled. */
const mutatingQueueSubcommands: ReadonlySet<QueueSubcommand> = new Set([
	"add",
	"bootstrap",
	"prune",
	"promote",
	"remove",
	"rule",
	"run",
	"sequence",
]);

/**
 * - Whether the queue workflow runs for this invocation.
 * - @param options - Parsed CLI options; `--queue` / `--no-queue` override the repository setting.
 * - @returns `true` unless the repository disabled the queue with `queue.enabled: false`.
 * - @remarks Consumers with no queue workflow set `queue.enabled: false` and never see a gate they
 *   cannot satisfy; the prompt contract is injected by `prompts/queue.ts` for the same reason.
 */
export function queueEnabled(options: CliOptions): boolean {
	return options.queueEnabled ?? config.queue.enabled;
}

/** Explains why a queue command is a no-op — or refuses — in a repository that disabled it. */
function runQueueDisabled(options: CliOptions): void {
	const subcommand = options.queueSubcommand ?? "list";
	if (options.jsonOut) {
		console.log(JSON.stringify({ enabled: false, subcommand }, undefined, 2));
	}

	if (mutatingQueueSubcommands.has(subcommand)) {
		throw new Error(
			`Queue workflow is disabled (queue.enabled: false in sandcastle.config.ts); pass --queue to run \`queue ${subcommand}\` anyway.`,
		);
	}

	console.log("  ⏭ Queue workflow disabled (queue.enabled: false); nothing to check.");
}

/** Runs the `sandcastle queue` command group; `run` returns the dispatch promise. */
export function runQueueCommand(options: CliOptions): void | Promise<void> {
	if (!queueEnabled(options)) {
		runQueueDisabled(options);
		return;
	}

	switch (options.queueSubcommand) {
		case "add": {
			runQueueAdd(options);
			break;
		}
		case "bootstrap": {
			runQueueBootstrap(options);
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
		case "promote": {
			runQueuePromote(options);
			break;
		}
		case "prune": {
			runQueuePrune(options);
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
		case "run": {
			return runQueueRun(options);
		}
		case "sequence": {
			runQueueSequence(options);
			break;
		}
	}
}

function liveView(strictGates: boolean): QueueView {
	const manifest = readQueueManifest();
	const live = fetchLiveQueueState({
		numbers: referencedIssues(manifest),
		readyLabel: config.labels.readyForAgent,
	});
	return computeQueueView(manifest, live, { strictGates });
}

function runQueueList(options: CliOptions): void {
	const view = liveView(false);
	if (options.jsonOut) {
		console.log(JSON.stringify(view, undefined, 2));
		return;
	}

	console.log(renderQueueText(view));
}

function runQueueCheck(options: CliOptions): void {
	const relaxed = liveView(false);
	const strict = options.queueStrictGates === true ? liveView(true) : relaxed;
	if (options.jsonOut) {
		console.log(JSON.stringify(strict, undefined, 2));
	} else {
		console.log(renderQueueText(strict));
	}

	if (relaxed.drift.length > 0) {
		console.error(
			`  ✗ Queue drift: ${relaxed.drift.length} problem(s). Resolve before firing.`,
		);
		io.exit(1);
	}

	if (strict.drift.length > relaxed.drift.length) {
		console.error("  ✗ Stale gates: promote or re-gate the issues listed above.");
		io.exit(2);
	}

	console.log("  ✓ No queue drift.");
}

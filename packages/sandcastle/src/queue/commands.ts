/*
 * Queue command orchestration.
 *
 * Thin glue between the parsed CLI options and the queue modules. Reads (`list`, `check`) fetch live
 * GitHub state and render the view; mutations live in `ops.ts`; dispatch lives in `run.ts`. `check`
 * exits 1 on drift and 2 when `--strict-gates` finds a stale gate, so the freshness pass is
 * scriptable while a stale gate stays a distinct failure.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import type { CliOptions } from "../cli.js";
import { config, io, repoRoot } from "../runtime.js";
import { upsertGraphComment } from "./comment.js";
import { sequenceGateNames, unmetIntegrationGates } from "./gates.js";
import {
	buildQueueGraph,
	renderQueueAscii,
	renderQueueMarkdown,
	renderQueueMermaid,
} from "./graph.js";
import { fetchLiveQueueState, resolveRepositoryIdentifiers } from "./live.js";
import { readQueueManifest, referencedIssues } from "./manifest.js";
import {
	runQueueAdd,
	runQueuePromote,
	runQueuePrune,
	runQueueRemove,
	runQueueRule,
	runQueueSequence,
} from "./ops.js";
import { emitText } from "./output.js";
import { computeQueueView, type QueueView, renderQueueText } from "./render.js";
import { runQueueBootstrap, runQueueRun } from "./run.js";
import { openBrowser, startQueueServer } from "./serve.js";

export type QueueSubcommand =
	| "add"
	| "run"
	| "list"
	| "rule"
	| "check"
	| "graph"
	| "prune"
	| "serve"
	| "remove"
	| "promote"
	| "sequence"
	| "bootstrap";

export const queueSubcommands: ReadonlyArray<QueueSubcommand> = [
	"add",
	"bootstrap",
	"check",
	"graph",
	"list",
	"prune",
	"promote",
	"remove",
	"rule",
	"run",
	"sequence",
	"serve",
];

const queueSubcommandSet: ReadonlySet<string> = new Set(queueSubcommands);

export function isQueueSubcommand(value: string | undefined): value is QueueSubcommand {
	return value !== undefined && queueSubcommandSet.has(value);
}

/** Queue subcommands that change the manifest and therefore refuse to run while disabled. */
const mutatingQueueSubcommands: ReadonlySet<QueueSubcommand> = new Set([
	"add",
	"bootstrap",
	"promote",
	"prune",
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
		case "graph": {
			runQueueGraph(options);
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
		case "serve": {
			return runQueueServe(options);
		}
	}
}

function liveView(strictGates: boolean): QueueView {
	const manifest = readQueueManifest();
	const live = fetchLiveQueueState({
		numbers: referencedIssues(manifest),
		readyLabel: config.labels.readyForAgent,
	});
	const gates = unmetIntegrationGates({ names: sequenceGateNames(manifest) });
	return computeQueueView(manifest, live, { gates, strictGates });
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

/** `--json` asks for the machine payload, exactly as `--format json` does. */
function graphFormat(options: CliOptions): "json" | "ascii" | "mermaid" {
	if (options.queueFormat !== undefined) {
		return options.queueFormat;
	}

	return options.jsonOut ? "json" : "mermaid";
}

/** Writes the Markdown page, creating the directory a `--write docs/...` path needs. */
function writeGraphPage(path: string, contents: string): string {
	const target = pathResolve(repoRoot, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, contents, "utf-8");
	return target;
}

/**
 * `queue graph`: the run order and the constraints on it, rendered for a human.
 *
 * One payload ({@link buildQueueGraph}) feeds three renderings, so the Mermaid block in a comment
 * and the page `queue serve` hosts cannot disagree. `--write` and `--comment` both publish the
 * Markdown page, which is timestamp-free so a committed copy can be diffed for schedule drift.
 */
/**
 * `queue serve`: the same graph, as a page the reader can open and click through.
 *
 * The Mermaid block is the artifact to share and the terminal rendering is the one to glance at;
 * this is the one to explore - layers toggle, a batch opens, and the detail panel reads the raw
 * view instead of a summary of it. Loopback only, read-only, and never a manifest write.
 */
async function runQueueServe(options: CliOptions): Promise<void> {
	const server = await startQueueServer({
		host: options.queueHost,
		port: options.queuePort,
	});
	emitText(options, `  ✓ Queue graph on ${server.url} (Ctrl+C stops it)`);
	if (options.queueOpen === true) {
		openBrowser(server.url);
	}

	await server.closed;
}

function runQueueGraph(options: CliOptions): void {
	const view = liveView(false);
	const identifiers = resolveRepositoryIdentifiers();
	const graph = buildQueueGraph(view, {
		generatedAt: new Date().toISOString(),
		repository: identifiers,
	});
	const expanded = options.queueExpandIssues === true;

	if (options.queueWrite !== undefined || options.queueComment !== undefined) {
		const markdown = renderQueueMarkdown(graph, { issues: expanded });
		if (options.queueWrite !== undefined) {
			emitText(options, `  ✓ Wrote ${writeGraphPage(options.queueWrite, markdown)}`);
		}

		if (options.queueComment !== undefined) {
			const outcome = upsertGraphComment({
				body: markdown,
				issue: options.queueComment,
				repository: `${identifiers.owner}/${identifiers.name}`,
			});
			const verb = outcome === "created" ? "Posted" : "Updated";
			emitText(options, `  ✓ ${verb} the queue graph on #${options.queueComment}`);
		}

		return;
	}

	switch (graphFormat(options)) {
		case "ascii": {
			console.log(renderQueueAscii(graph));
			break;
		}
		case "json": {
			console.log(JSON.stringify(graph, undefined, 2));
			break;
		}
		case "mermaid": {
			console.log(renderQueueMermaid(graph, { issues: expanded }));
			break;
		}
	}
}

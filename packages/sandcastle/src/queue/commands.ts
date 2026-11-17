/*
 * Queue command orchestration.
 *
 * Thin glue between the parsed CLI options and the queue modules. Reads (`list`, `check`) fetch live
 * GitHub state and render the view; mutations live in `ops.ts`; dispatch lives in `run.ts`. `check`
 * exits 1 on drift and 2 when `--strict-gates` finds a stale gate, so the freshness pass is
 * scriptable while a stale gate stays a distinct failure.
 *
 * Every collaborator arrives on the {@link QueueContext}: this module names none of the real
 * modules' readers, fetchers, printers, or exit, so a suite can drive a whole subcommand from canned
 * live state and assert the printed line, the exit code, and the manifest it asked to write.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import type { CliOptions } from "../cli.js";
import { config, repoRoot } from "../runtime.js";
import { runQueueCancel } from "./cancel.js";
import { runQueueClean } from "./clean.js";
import { upsertGraphComment } from "./comment.js";
import { createQueueContext, type QueueContext } from "./context.js";
import {
	buildQueueGraph,
	renderQueueAscii,
	renderQueueMarkdown,
	renderQueueMermaid,
} from "./graph.js";
import { runQueueLand } from "./land.js";
import {
	runQueueAdd,
	runQueueMigrate,
	runQueuePromote,
	runQueuePrune,
	runQueueRemove,
	runQueueRule,
	runQueueSequence,
} from "./ops.js";
import { computeQueueView, type QueueView, renderQueueText } from "./render.js";
import { runQueueBootstrap, runQueueRun } from "./run.js";
import { isLoopbackHost, openBrowser, startQueueServer } from "./serve.js";
export type QueueSubcommand =
	| "add"
	| "run"
	| "land"
	| "list"
	| "rule"
	| "check"
	| "graph"
	| "prune"
	| "serve"
	| "clean"
	| "cancel"
	| "remove"
	| "migrate"
	| "promote"
	| "sequence"
	| "bootstrap";

export const queueSubcommands: ReadonlyArray<QueueSubcommand> = [
	"land",
	"migrate",
	"add",
	"bootstrap",
	"cancel",
	"check",
	"clean",
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
	"clean",
	"land",
	"migrate",
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
 *   cannot satisfy; the prompt contract is injected by `prompts/queue.ts` for the same reason. This
 *   stays a standalone helper because `cli.ts` and the dispatch path ask the same question without
 *   a context in hand; {@link QueueContext.enabled} is the same answer for callers that have one.
 */
export function queueEnabled(options: CliOptions): boolean {
	return options.queueEnabled ?? config.queue.enabled;
}

/** Explains why a queue command is a no-op — or refuses — in a repository that disabled it. */
function runQueueDisabled(options: CliOptions, context: QueueContext): void {
	const subcommand = options.queueSubcommand ?? "list";
	if (options.jsonOut) {
		context.output.json({ enabled: false, subcommand });
	}

	if (mutatingQueueSubcommands.has(subcommand)) {
		throw new Error(
			`Queue workflow is disabled (queue.enabled: false in sandcastle.config.ts); pass --queue to run \`queue ${subcommand}\` anyway.`,
		);
	}

	context.output.line("  ⏭ Queue workflow disabled (queue.enabled: false); nothing to check.");
}

/**
 * Runs the `sandcastle queue` command group; `run` returns the dispatch promise.
 *
 * @remarks
 *   `cancel` runs before the enabled check on purpose. Its job is to release what a dead run left
 *   behind — a lock file, a lease ref on `origin` — and none of that stops existing because the
 *   repository turned the workflow off. Reporting "nothing to check" there would be false, and the
 *   residue would keep a later re-enable from dispatching.
 * @param options - The parsed CLI options.
 * @param context - The collaborators; defaults to {@link createQueueContext} for this invocation.
 */
export function runQueueCommand(
	options: CliOptions,
	context: QueueContext = createQueueContext(options),
): void | Promise<void> {
	if (options.queueSubcommand === "cancel") {
		if (!runQueueCancel(options)) {
			context.exit(1);
		}

		return;
	}

	if (!context.enabled(options)) {
		runQueueDisabled(options, context);
		return;
	}

	switch (options.queueSubcommand) {
		case "add": {
			runQueueAdd(options, context);
			break;
		}
		case "bootstrap": {
			runQueueBootstrap(options);
			break;
		}
		case "check": {
			runQueueCheck(options, context);
			break;
		}
		case "clean": {
			runQueueClean(options);
			break;
		}
		case "graph": {
			runQueueGraph(options, context);
			break;
		}
		case "land": {
			return runQueueLand(options);
		}
		case "list": {
			runQueueList(options, context);
			break;
		}
		case "migrate": {
			runQueueMigrate(options, context);
			break;
		}
		case "promote": {
			runQueuePromote(options, context);
			break;
		}
		case "prune": {
			runQueuePrune(options, context);
			break;
		}
		case "remove": {
			runQueueRemove(options, context);
			break;
		}
		case "rule": {
			runQueueRule(options, context);
			break;
		}
		case "run": {
			return runQueueRun(options);
		}
		case "sequence": {
			runQueueSequence(options, context);
			break;
		}
		case "serve": {
			return runQueueServe(options, context);
		}
	}
}

function liveView(context: QueueContext, strictGates: boolean): QueueView {
	const manifest = context.readManifest();
	const live = context.fetchLive(manifest);
	const view = computeQueueView(manifest, live, {
		gates: context.gates(manifest),
		strictGates,
	});
	/*
	 * Chain containment is git state, which `computeQueueView` (pure over the manifest and GitHub)
	 * cannot see. A break here names members whose branches fell out of run order — usually a
	 * follow-up inserted ahead of members that had already run.
	 */
	view.drift.push(...context.chainDrift(manifest));
	return view;
}

function runQueueList(options: CliOptions, context: QueueContext): void {
	const view = liveView(context, false);
	if (options.jsonOut) {
		context.output.json(view);
		return;
	}

	context.output.line(renderQueueText(view));
}

function runQueueCheck(options: CliOptions, context: QueueContext): void {
	const relaxed = liveView(context, false);
	const strict = options.queueStrictGates === true ? liveView(context, true) : relaxed;
	if (options.jsonOut) {
		context.output.json(strict);
	} else {
		context.output.line(renderQueueText(strict));
	}

	if (relaxed.drift.length > 0) {
		context.output.problem(
			`  ✗ Queue drift: ${relaxed.drift.length} problem(s). Resolve before firing.`,
		);
		context.exit(1);
	}

	if (strict.drift.length > relaxed.drift.length) {
		context.output.problem("  ✗ Stale gates: promote or re-gate the issues listed above.");
		context.exit(2);
	}

	context.output.line("  ✓ No queue drift.");
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
async function runQueueServe(options: CliOptions, context: QueueContext): Promise<void> {
	const server = await startQueueServer({
		host: options.queueHost,
		port: options.queuePort,
		/*
		 * The page asks for the same view `queue list` prints — through the same context — so a batch
		 * cannot read READY in one rendering and GATED in the other.
		 */
		view: (strictGates) => liveView(context, strictGates),
	});
	context.output.line(`  ✓ Queue graph on ${server.url} (Ctrl+C stops it)`);
	/*
	 * `--host` is the deliberate opt-out of loopback, so leaving it is reported rather than refused:
	 * the flag exists for a reason, but exposing the queue to the network should never be silent.
	 */
	if (!isLoopbackHost(server.host)) {
		context.output.line(
			`  ⚠ Bound to ${server.host}, not loopback: the queue page is reachable from the network.`,
		);
	}

	if (options.queueOpen === true) {
		openBrowser(server.url);
	}

	await server.closed;
}

function runQueueGraph(options: CliOptions, context: QueueContext): void {
	const view = liveView(context, false);
	const identifiers = context.repository();
	const { parallel, profiles } = context.lanes();
	const graph = buildQueueGraph(view, {
		generatedAt: new Date().toISOString(),
		parallel,
		profiles,
		repository: identifiers,
	});
	const expanded = options.queueExpandIssues === true;

	if (options.queueWrite !== undefined || options.queueComment !== undefined) {
		const markdown = renderQueueMarkdown(graph, { issues: expanded });
		if (options.queueWrite !== undefined) {
			context.output.line(`  ✓ Wrote ${writeGraphPage(options.queueWrite, markdown)}`);
		}

		if (options.queueComment !== undefined) {
			const outcome = upsertGraphComment({
				body: markdown,
				issue: options.queueComment,
				repository: `${identifiers.owner}/${identifiers.name}`,
			});
			const verb = outcome === "created" ? "Posted" : "Updated";
			context.output.line(`  ✓ ${verb} the queue graph on #${options.queueComment}`);
		}

		return;
	}

	switch (graphFormat(options)) {
		case "ascii": {
			context.output.line(renderQueueAscii(graph));
			break;
		}
		case "json": {
			context.output.json(graph);
			break;
		}
		case "mermaid": {
			context.output.line(renderQueueMermaid(graph, { issues: expanded }));
			break;
		}
	}
}

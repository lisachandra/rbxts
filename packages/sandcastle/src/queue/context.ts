/*
 * The queue command layer's injected context.
 *
 * Every module the queue is built from takes its collaborators as parameters — `live.ts`, `gates.ts`,
 * `persist.ts`, `schedule.ts`, `render.ts`, `run.ts`, `land.ts` — and this is the layer that composes
 * them. Until now it took none: `commands.ts` and `ops.ts` called `readQueueManifest()`,
 * `fetchLiveQueueState({ … })`, and `unmetIntegrationGates({ … })` at their module-global defaults,
 * printed with `console.log`, and halted through `io.exit`. Nothing outside the process could make
 * the layer behave and nothing inside could observe it, which is why the behavior a human depends
 * on — `queue check`'s three exit codes, a mutation's message, a refused gate — had no suite.
 *
 * The context is that missing seam. It is built once, at the CLI edge, and threaded through
 * `runQueueCommand` into `commands.ts` and `ops.ts`.
 *
 * The split is deliberate: the context is *who does the work* (read, fetch, evaluate, transact,
 * print, exit) and the options stay *what is being asked* (`--issue`, `--dry-run`, `--apply`).
 * `transact` therefore takes the options as well — a dry run and a commit policy are per-invocation
 * requests, not collaborators — while `output` is bound to the invocation at construction, because
 * where a line goes is a property of the run, not of the call.
 */

import type { CliOptions } from "../cli.js";
import { config, io } from "../runtime.js";
import { inspectChainSequences } from "./chain.js";
import { sequenceGateNames, unmetIntegrationGates } from "./gates.js";
import { fetchLiveQueueState, type LiveQueueState, resolveRepositoryIdentifiers } from "./live.js";
import { acquireQueueLock, manifestLockName } from "./lock.js";
import {
	type QueueManifest,
	queueManifestPath,
	readQueueManifest,
	referencedIssues,
} from "./manifest.js";
import { readRawQueueManifest } from "./migrate.js";
import { emitJson } from "./output.js";
import { publishQueueManifest, type QueueTransaction, transactQueueManifest } from "./persist.js";
import { profileForLane } from "./profile.js";

/** How one queue invocation prints. */
export interface QueueOutput {
	/** A machine payload on stdout, for `--json`. */
	json(value: unknown): void;
	/** A human line: stdout, or stderr when `--json` owns stdout. */
	line(line: string): void;
	/** A problem report, always on stderr, so `--json` consumers never parse it as payload. */
	problem(line: string): void;
}

/**
 * Everything the queue command layer needs, and the whole of what it may reach.
 *
 * @remarks
 *   A test supplies fakes here and asserts what the command printed and what it asked to persist;
 *   production supplies {@link createQueueContext}, which wires the real modules. Neither
 *   `commands.ts` nor `ops.ts` reads a module global for any of these, so there is no third wiring
 *   to drift.
 */
export interface QueueContext {
	/** Chain-containment drift: git and phase state, which the pure view cannot see. */
	chainDrift(manifest: QueueManifest): Array<string>;
	/** Resolves `--queue` / `--no-queue` over the repository setting. */
	enabled(options: CliOptions): boolean;
	/** Halts the process with `code`. Typed `never`, like `io.exit`. */
	exit(code: number): never;
	/** Live GitHub state for every issue the manifest references. */
	fetchLive(manifest: QueueManifest): LiveQueueState;
	/** Why each declared run-order gate is unmet; an absent name means safe to fire. */
	gates(manifest: QueueManifest): ReadonlyMap<string, string>;
	/**
	 * The parallel-dispatch shape: `queue.parallel` and the profile each lane slot runs.
	 *
	 * @remarks
	 *   Resolved through `profileForLane`, the same function the pool calls, so the graph names the
	 *   model a slot would actually run — including the wrap when the catalog is shorter than the
	 *   limit. `profiles` is empty when `agents.catalog` is, because dispatch then refuses
	 *   `--parallel` rather than inventing a default.
	 */
	lanes(): { parallel: number; profiles: Array<string> };
	/** The manifest path, for the messages that name where the queue lives. */
	manifestPath(): string;
	/** How this invocation prints. */
	readonly output: QueueOutput;
	/**
	 * Replaces the manifest under the manifest lock, without reading it first.
	 *
	 * @remarks
	 *   `queue migrate` is the one caller: it must not read first, because
	 *   {@link QueueContext.readManifest} refuses a v1 file by name — which is the very file it
	 *   exists to translate. Every other mutation goes through {@link QueueContext.transact}, so it
	 *   cannot lose a concurrent writer.
	 * @param options - Parsed CLI options; the commit policy is read from them.
	 * @param manifest - The manifest to write.
	 * @param summary - Imperative subject for the commit.
	 */
	overwrite(options: CliOptions, manifest: QueueManifest, summary: string): void;
	/**
	 * Writes a settled manifest and publishes it: location notice, then the opt-in commit.
	 *
	 * @param options - Parsed CLI options; the commit policy is read from them.
	 * @param manifest - The manifest the transaction settled on.
	 * @param summary - Imperative subject for the commit.
	 */
	publish(options: CliOptions, manifest: QueueManifest, summary: string): void;
	/** Reads the manifest the commands act on. */
	readManifest(): QueueManifest;
	/** Reads any manifest version verbatim, which is what `queue migrate` needs. */
	readRawManifest(): unknown;
	/** The label that marks an issue as ready for an agent. */
	readonly readyForAgent: string;
	/** The `owner/name` the graph links against. */
	repository(): { readonly name: string; readonly owner: string };
	/** One read → mutate → write cycle under the manifest lock. */
	transact(
		options: CliOptions,
		transact: (manifest: QueueManifest) => QueueTransaction,
	): QueueManifest;
}

/**
 * - Binds the real collaborators to one invocation.
 * - @param options - The parsed CLI options, whose `--json` decides where human lines go.
 * - @returns The context `runQueueCommand` threads into `commands.ts` and `ops.ts`.
 * - @remarks The only place the layer's real dependencies are named. `runQueueCommand` defaults to
 *   this so programmatic callers keep working, and `main.ts` passes it explicitly so the wiring is
 *   visible at the entry point rather than inferred from a default.
 */
export function createQueueContext(options: CliOptions): QueueContext {
	return {
		chainDrift: (manifest) => inspectChainSequences(manifest),
		enabled: (current) => current.queueEnabled ?? config.queue.enabled,
		exit: (code) => io.exit(code),
		fetchLive: (manifest) =>
			fetchLiveQueueState({
				numbers: referencedIssues(manifest),
				readyLabel: config.labels.readyForAgent,
			}),
		gates: (manifest) => unmetIntegrationGates({ names: sequenceGateNames(manifest) }),
		lanes: () => {
			const { parallel } = config.queue;
			/*
			 * `profileForLane` rather than `catalog.slice(0, parallel)`: a two-profile catalog at
			 * `--parallel 4` wraps to sonnet, flash, sonnet, flash, and the graph would otherwise
			 * claim slots 3 and 4 run nothing.
			 */
			const profiles: Array<string> = [];
			for (let slot = 0; slot < parallel; slot++) {
				const profile = profileForLane(config.agents.catalog, slot);
				if (profile !== undefined) {
					profiles.push(profile.name);
				}
			}

			return { parallel, profiles };
		},
		manifestPath: () => queueManifestPath(),
		output: {
			json: (value) => {
				emitJson(value);
			},
			// Bound to the invocation's `--json`, so the layer never asks where a line goes.
			line: (line) => {
				if (options.jsonOut) {
					console.error(line);
				} else {
					console.log(line);
				}
			},
			problem: (line) => {
				console.error(line);
			},
		},
		overwrite: (current, manifest, summary) => {
			/*
			 * The lock is held across read-free writes too: `queue migrate` replaces the whole file, and a
			 * concurrent `queue add` holding the lock is mid read-modify-write on the same bytes.
			 */
			const release = acquireQueueLock({ name: manifestLockName });
			try {
				publishQueueManifest(current, manifest, summary);
			} finally {
				release();
			}
		},
		publish: (current, manifest, summary) => {
			publishQueueManifest(current, manifest, summary);
		},
		readManifest: () => readQueueManifest(),
		readRawManifest: () => readRawQueueManifest(queueManifestPath()),
		readyForAgent: config.labels.readyForAgent,
		repository: () => resolveRepositoryIdentifiers(),
		transact: (current, transact) => transactQueueManifest(current, transact),
	};
}

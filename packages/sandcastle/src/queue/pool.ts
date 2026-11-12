/*
 * Parallel batch dispatch: `queue run --parallel <n>`.
 *
 * Members inside a batch are strictly serial — each member's branch is the next member's base — so
 * parallelism exists only *between* batches. That is already safe by construction: every batch
 * branches from the base ref, `after` gates encode the real dependencies, and an `R<n>` rule is the
 * repository's own statement that two issues must never be in flight together.
 *
 * Each lane runs its batch in a child `sandcastle queue run --name <batch> --once` process. A child
 * rather than a promise because dispatch is fatal on failure (`sequential.ts` exits the process when a
 * member fails or blocks) and because the phase pipeline owns stdout: in one process, one blocked
 * batch would take its siblings down and every log would interleave into an unreadable stream.
 *
 * The parent keeps three things the child cannot: the run lock, the schedule, and the hand-off.
 * Landing stays serial in the parent so two compositions never race on an integration manifest, and an
 * over-budget batch is refused before it starts because a batch is atomic.
 */

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CliOptions } from "../cli.js";
import type { AgentProfile } from "../config.js";
import { config, logsDir } from "../runtime.js";
import { inspectChainSequences } from "./chain.js";
import { sequenceGateNames, unmetIntegrationGates } from "./gates.js";
import { fetchLiveQueueState } from "./live.js";
import { readQueueManifest, referencedIssues } from "./manifest.js";
import { emitJson, emitText } from "./output.js";
import { profileByName, profileForLane } from "./profile.js";
import { computeQueueView } from "./render.js";
import { selectNextBatch } from "./schedule.js";

/** Tail of a failed lane's log echoed into the terminal. */
const failureTailLines = 30;

/** Ceiling for one lane's log before it rotates, matching the setup log's limit. */
const laneLogMaxBytes = 5 * 1024 * 1024;

/** One batch's run in a lane. */
export interface LaneRun {
	/** The batch this lane fired. */
	batch: string;
	/** Wall-clock milliseconds the child was alive. */
	elapsedMs: number;
	/** Human-readable failure, absent when the child exited zero. */
	error?: string;
	/** Lane index, i.e. the slot this batch took. */
	lane: number;
	/** Catalog profile the lane ran. */
	profile: string;
}

/**
 * One lane's own account of its work, for the completion summary.
 *
 * A batch's elapsed time says how long a unit of work took; a lane's says whether a _slot_ was
 * worth having. Since a lane runs several batches over a pool, the interesting number is the sum of
 * its batches against the pool's duration — the gap is the time that slot sat empty.
 */
export interface LaneSummary {
	/** Batches this lane ran, in fire order, with the profile each used. */
	batches: Array<{ batch: string; elapsedMs: number; profile: string }>;
	/** Milliseconds this lane spent running batches. */
	busyMs: number;
	/** Milliseconds this lane was idle: the pool's duration minus its busy time. */
	idleMs: number;
	/** Lane index, i.e. the slot. */
	lane: number;
}

/** Everything the pool reports back to `runQueueRun`. */
export interface PoolResult {
	/** Batches fired, in fire order. */
	batches: Array<string>;
	/** Batches that completed successfully, in completion order. */
	completed: Array<LaneRun>;
	/**
	 * Wall-clock milliseconds from the first spawn to the last completion, or 0 when nothing fired.
	 * A dry run reports 0: it measures work, and a prediction is not work.
	 */
	elapsedMs?: number;
	/** Lanes that failed, in completion order. */
	failures: Array<LaneRun>;
	/**
	 * Distinct reasons a free lane could not be filled, in first-seen order.
	 *
	 * Empty means the pool stayed full until it ran out of work. A non-empty list with a short
	 * `elapsedMs` is the signature of a pool that was never really parallel.
	 */
	idleReasons?: Array<string>;
	/** Issues committed to a lane, for the caller's budget and `seen` set. */
	issues: Array<string>;
	/** Per-slot account of what each lane ran and how much of the pool it was busy for. */
	lanes?: Array<LaneSummary>;
	/**
	 * Milliseconds during which every lane was busy.
	 *
	 * Sampled at each completion, not measured per slot, so it is the pool's own view of its
	 * occupancy rather than an exact integral. Good enough to tell a well-fed pool from a starved
	 * one.
	 */
	saturatedMs?: number;
}

/** Everything a lane needs to run one batch. */
export interface LaneSpawnParams {
	/** Batch to fire (the child's `--name`). */
	batch: string;
	/** Absolute log path the child's stdout and stderr are redirected into. */
	logPath: string;
	/** The parsed options the child is derived from. */
	options: CliOptions;
	/** Catalog profile the lane runs. */
	profile: AgentProfile;
}

/** Starts one lane; production spawns a child process, tests inject a stub. */
export type SpawnLane = (params: LaneSpawnParams) => Promise<{ error?: string; ok: boolean }>;

/** Absolute path of the CLI entry point, so a child re-enters the same build. */
function entryPoint(): string {
	// `dist/queue/pool.js` → `dist/main.js`.
	return pathResolve(dirname(fileURLToPath(import.meta.url)), "..", "main.js");
}

/**
 * Arguments forwarded to a lane's child.
 *
 * Only per-run _behavior_ travels: a child must apply the same setup, resume, and reclaim policy as
 * the parent, or a lane would silently differ from a serial run. Scheduling inputs (`--parallel`,
 * `--max-issues`, `--land`, `--create-pr`) deliberately do not: the parent owns them, and letting a
 * child land its own batch would duplicate hand-off work the parent is already sequencing.
 */
export function laneArgs({ batch, options, profile }: LaneSpawnParams): Array<string> {
	const args = ["queue", "run", "--name", batch, "--once", "--profile", profile.name];
	if (options.base !== undefined && options.base !== "") {
		args.push("--base", options.base);
	}

	const forwarded = [
		[options.ignoreSetup === true, "--ignore-setup"],
		[options.skipSetup === true, "--skip-setup"],
		[options.pushAndDelete === true, "--push-and-delete"],
		[options.noResume === true, "--no-resume"],
		[options.strictChain === true, "--strict-chain"],
		[options.jsonOut === true, "--json"],
	] as const;
	for (const [enabled, flag] of forwarded) {
		if (enabled) {
			args.push(flag);
		}
	}

	if (options.setupOutput !== undefined) {
		args.push("--setup-output", options.setupOutput);
	}

	return args;
}

/** Opens a lane's log for append, rotating one that has grown past the ceiling. */
function openLaneLog(logPath: string): number {
	mkdirSync(dirname(logPath), { recursive: true });
	const size = statSync(logPath, { throwIfNoEntry: false })?.size ?? 0;
	if (size > laneLogMaxBytes) {
		try {
			renameSync(logPath, `${logPath}.1`);
		} catch {
			// Best-effort: a log that cannot be rotated is still writable.
		}
	}

	return openSync(logPath, "a");
}

/** Last lines of a failed lane's log, or `undefined` when it is empty or unreadable. */
function logTail(logPath: string): string | undefined {
	try {
		const lines = readFileSync(logPath, "utf-8").trimEnd().split(/\r?\n/u);
		if (lines.join("").trim() === "") {
			return undefined;
		}

		return lines.slice(-failureTailLines).join("\n");
	} catch {
		return undefined;
	}
}

/** Environment marker so a child never re-enters the pool. */
export const childEnvKey = "SANDCASTLE_QUEUE_RUN_CHILD";

/** Whether this process is a lane child. */
export function isLaneChild(): boolean {
	return process.env[childEnvKey] === "1";
}

/** Absolute log path for one batch in one lane. */
export function laneLogPath(batch: string, profile: string): string {
	return pathResolve(logsDir, `batch-${batch}.${profile}.log`);
}

/**
 * - Spawns a lane's child and waits for it.
 * - @param params - Batch, log, profile, and derived options.
 * - @returns `ok` on a zero exit; otherwise the exit reason plus the log's tail.
 * - @remarks The child's output never reaches the parent's stdout: the log is the lane's report, and
 *   the parent prints one line per lane event so a `--json` consumer still sees parseable output.
 */
const spawnLane: SpawnLane = (params) =>
	new Promise((resolve) => {
		const fd = openLaneLog(params.logPath);
		const child = spawn(process.execPath, [entryPoint(), ...laneArgs(params)], {
			env: { ...process.env, [childEnvKey]: "1" },
			stdio: ["ignore", fd, fd],
			windowsHide: true,
		});

		const finish = (ok: boolean, error?: string): void => {
			try {
				closeSync(fd);
			} catch {
				// Best-effort.
			}

			resolve(error === undefined ? { ok } : { error, ok });
		};

		child.on("error", (error) => {
			finish(false, String(error));
		});
		child.on("close", (code, signal) => {
			if (code === 0) {
				finish(true);
				return;
			}

			const tail = logTail(params.logPath);
			const reason =
				signal !== null ? `killed by ${signal}` : `exited ${String(code ?? "unknown")}`;
			finish(
				false,
				tail === undefined
					? `${reason}; ${params.logPath} is empty or unreadable.`
					: `${reason}. Last lines of ${params.logPath}:\n${tail}`,
			);
		});
	});

/** One in-flight lane. */
interface RunningLane {
	batch: string;
	lane: number;
	profile: AgentProfile;
	settled: Promise<LaneRun>;
}

/**
 * - Runs ready batches, up to `parallel` at a time, each in its own child process.
 * - @param options - Parsed CLI options; `--parallel`, `--name`, and `--max-issues` are read here.
 * - @param spawnLaneImpl - Lane starter; tests inject a stub.
 * - @returns Every batch fired, every issue committed, and every failure.
 * - @remarks Greedy fill in manifest order: whenever a lane frees up, the next READY batch that no
 *   rule excludes starts. There is no lookahead, so a long batch can idle a lane that a shorter
 *   later batch would have filled — that is the cost of a schedule a human can still read off the
 *   manifest.
 */
/**
 * - Runs ready batches, up to `parallel` at a time, each in its own child process.
 * - @param options - Parsed CLI options; `--parallel`, `--name`, and `--max-issues` are read here.
 * - @param spawnLaneImpl - Lane starter; tests inject a stub.
 * - @param leaseLost - Whether the cross-machine lease was lost; checked at each batch boundary.
 * - @returns Every batch fired, every issue committed, and every failure.
 * - @remarks Greedy fill in manifest order: whenever a lane frees up, the next READY batch that no
 *   rule excludes starts. There is no lookahead, so a long batch can idle a lane that a shorter
 *   later batch would have filled — that is the cost of a schedule a human can still read off the
 *   manifest.
 */
export async function runParallelPool(
	options: CliOptions,
	spawnLaneImpl: SpawnLane = spawnLane,
	leaseLost: () => boolean = () => false,
): Promise<PoolResult> {
	const parallel = options.queueParallel ?? config.queue.parallel;
	const { catalog } = config.agents;
	const pinned = profileByName(catalog, options.queueProfile);
	/** Issues committed to a lane: the reservation set the scheduler reads as "in flight". */
	const reserved = new Set<string>();
	const batches: Array<string> = [];
	const failures: Array<LaneRun> = [];
	const completed: Array<LaneRun> = [];
	const running = new Map<number, RunningLane>();
	const maxIssues = options.maxIssues ?? Number.POSITIVE_INFINITY;
	/** Reasons a free lane had nowhere to put its next batch; deduplicated, first-seen order. */
	const idleReasons: Array<string> = [];
	const noteIdle = (reason: string): void => {
		if (!idleReasons.includes(reason)) {
			idleReasons.push(reason);
		}
	};

	/** Lanes ever used, so a dry run's lane numbers still count up. */
	let nextLane = 0;
	/** Slots currently free; a freed slot is reused before a new one is numbered. */
	const freeSlots: Array<number> = [];

	/**
	 * - Reserves a lane slot for a batch.
	 * - @returns The slot index, reusing the lowest freed one.
	 * - @remarks A lane is a dispatch _slot_, not an identity: with `--parallel 2` the third batch
	 *   must run in slot 0 or 1, not in a "slot 3". Numbering every batch afresh would make the
	 *   lane a batch counter, and a per-lane busy/idle report built on it would describe nothing —
	 *   which is why #62's utilization summary needs real slots underneath it.
	 */
	const takeSlot = (): number => {
		const reused = freeSlots.shift();
		if (reused !== undefined) {
			return reused;
		}

		const fresh = nextLane;
		nextLane += 1;
		return fresh;
	};

	let stopped = false;
	let startedAt: number | undefined;
	let saturatedMs = 0;
	/** When the current full-occupancy stretch began, if one is in progress. */
	let fullSince: number | undefined;

	const start = (batch: string, lane: number, issues: ReadonlyArray<string>): void => {
		const profile = pinned ?? profileForLane(catalog, lane);
		if (profile === undefined) {
			throw new Error(
				"queue run --parallel needs agents.catalog in sandcastle.config.ts: each lane draws one model + harness profile from it.",
			);
		}

		for (const issue of issues) {
			reserved.add(issue);
		}

		batches.push(batch);
		const params: LaneSpawnParams = {
			batch,
			logPath: laneLogPath(batch, profile.name),
			options,
			profile,
		};

		const startedAtLane = Date.now();
		startedAt ??= startedAtLane;
		emitText(options, `\n▶ Lane ${String(lane + 1)}: "${batch}" [${profile.name}]`);
		emitText(options, `  log: ${params.logPath}`);
		if (options.jsonOut === true) {
			emitJson({
				batch,
				issues: [...issues],
				kind: "lane",
				lane: lane + 1,
				profile: profile.name,
			});
		}

		const settled = spawnLaneImpl(params).then(
			(outcome): LaneRun => ({
				batch,
				elapsedMs: Date.now() - startedAtLane,
				lane,
				profile: profile.name,
				...(outcome.error === undefined ? {} : { error: outcome.error }),
			}),
		);
		running.set(lane, { batch, lane, profile, settled });

		/* The pool became full as a result of this start: open a new saturated stretch. */
		if (running.size >= parallel) {
			fullSince = Date.now();
		}
	};

	/** Accumulates the full-occupancy stretch that ends now, if one was in progress. */
	const closeFullStretch = (): void => {
		if (fullSince === undefined) {
			return;
		}

		saturatedMs += Date.now() - fullSince;
		fullSince = undefined;
	};

	for (;;) {
		/*
		 * A member's review committing to the manifest, and a lane finishing, both change what is
		 * runnable, so the view is rebuilt before every fill.
		 */
		while (!stopped && running.size < parallel) {
			/*
			 * Checked here rather than mid-phase: a lane that already started is allowed to finish, so
			 * losing the lease stops the *schedule* without corrupting work in flight.
			 */
			if (leaseLost()) {
				emitText(
					options,
					"  ⏹ Another checkout took the dispatch lease; not starting further batches.",
				);
				stopped = true;
				break;
			}

			const manifest = readQueueManifest();
			const live = fetchLiveQueueState({
				numbers: referencedIssues(manifest),
				readyLabel: config.labels.readyForAgent,
			});
			const view = computeQueueView(manifest, live, {
				gates: unmetIntegrationGates({ names: sequenceGateNames(manifest) }),
				strictGates: true,
			});
			view.drift.push(...inspectChainSequences(manifest));

			const decision = selectNextBatch({
				batch: options.integrationName,
				manifest,
				seen: reserved,
				view,
			});
			if (decision.kind === "done") {
				/*
				 * A free lane with nothing to put in it is the one thing a parallel run must explain:
				 * otherwise "two lanes, four hours" looks the same whether the queue was starved or
				 * the work was never there. `saturated` says the remaining batches are already in
				 * flight, which is not a problem to report.
				 */
				if (running.size > 0 && running.size < parallel && decision.saturated !== true) {
					const idle = parallel - running.size;
					emitText(options, `  ⏸ ${String(idle)} lane(s) idle: ${decision.reason}`);
					noteIdle(decision.reason);
				}

				/* Nothing fired at all: report the exhaustion exactly as the serial loop does. */
				if (batches.length === 0) {
					reportExhausted(options, decision.reason);
				}

				break;
			}

			/*
			 * A batch is atomic: trimming it to fit would break the chain each member's branch forms,
			 * so an over-budget batch stops the pool exactly as it stops the serial loop.
			 */
			if (reserved.size + decision.issues.length > maxIssues) {
				emitText(
					options,
					`  ⏹ --max-issues ${String(maxIssues)}: sequence "${decision.name}" (${String(decision.issues.length)} issue(s)) exceeds the remaining budget (${String(maxIssues - reserved.size)}); stopping.`,
				);
				stopped = true;
				break;
			}

			if (options.dryRun === true) {
				const preview = pinned ?? profileForLane(catalog, nextLane);
				const members = decision.issues.map((issue) => `#${issue}`).join(" → ");
				emitText(
					options,
					`  (dry run) lane ${String(nextLane + 1)} would fire "${decision.name}" [${preview?.name ?? "?"}]: ${members}`,
				);

				/*
				 * The decision a dry run predicts is still a decision: `--json` promises one object per
				 * lane, and a consumer that has to scrape stderr to learn the plan would be reading
				 * human text. `dryRun` marks it as a prediction of the same shape a real lane emits.
				 */
				if (options.jsonOut === true) {
					emitJson({
						batch: decision.name,
						dryRun: true,
						issues: decision.issues,
						kind: "lane",
						lane: nextLane + 1,
						profile: preview?.name,
					});
				}

				for (const issue of decision.issues) {
					reserved.add(issue);
				}

				batches.push(decision.name);
				nextLane += 1;
				continue;
			}

			start(decision.name, takeSlot(), decision.issues);
		}

		/* Nothing in flight: the invocation is over. */
		if (running.size === 0) {
			break;
		}

		/*
		 * Wait for the first lane to finish. Which one it was decides only what is reported here — the
		 * fill above re-reads the manifest, so a sibling's follow-up or a gate promotion is honored
		 * before the freed slot is handed out.
		 */
		const finished = await Promise.race([...running.values()].map((lane) => lane.settled));
		running.delete(finished.lane);
		freeSlots.push(finished.lane);
		freeSlots.sort((left, right) => left - right);
		closeFullStretch();

		if (finished.error === undefined) {
			completed.push(finished);
			emitText(
				options,
				`  ✓ "${finished.batch}" [${finished.profile}] finished in ${formatElapsed(finished.elapsedMs)}.`,
			);
		} else {
			/*
			 * Keep going: a blocked or failed batch is one lane's problem, and the queue's rule is that
			 * one stuck batch must not strand unrelated work. The failure is reported and counted.
			 */
			failures.push(finished);
			emitText(
				options,
				`  ✗ "${finished.batch}" [${finished.profile}] failed after ${formatElapsed(finished.elapsedMs)}.`,
			);
			if (options.jsonOut === true) {
				emitJson({ batch: finished.batch, error: finished.error, kind: "dispatch" });
			} else {
				emitText(options, indent(finished.error ?? ""));
			}
		}
	}

	closeFullStretch();
	const elapsedMs = startedAt === undefined ? 0 : Date.now() - startedAt;
	const lanes = summarizeLanes([...completed, ...failures], elapsedMs);

	/* A dry run has no work to summarize: it predicted, it did not run. */
	if (batches.length > 0 && options.dryRun !== true) {
		reportPool(options, {
			batches,
			completed,
			elapsedMs,
			failures,
			idleReasons,
			issues: [],
			lanes,
			saturatedMs,
		});
	}

	return {
		batches,
		completed,
		elapsedMs,
		failures,
		idleReasons,
		issues: [...reserved],
		lanes,
		saturatedMs,
	};
}

/** Reports "nothing could fire" in the same shape the serial loop uses. */
function reportExhausted(options: CliOptions, reason: string): void {
	if (options.jsonOut === true) {
		emitJson({ decision: "done", reason });
		return;
	}

	emitText(options, `  ⏹ Nothing to run: ${reason}`);
}

/**
 * - Groups finished lanes into one summary per slot.
 * - @param runs - Every lane that finished, successful or not.
 * - @param elapsedMs - The pool's own duration, which is what a lane's idle time is measured against.
 * - @returns One entry per lane index, ordered by lane.
 * - @remarks Per batch and per lane answer different questions. A batch's duration says how long the
 *   work took; a lane's says whether the slot earned its place. A pool can read as 100% busy and
 *   still have one slot that ran a single long batch while another ran six short ones — that is the
 *   shape issue #62 asks about.
 */
function summarizeLanes(runs: ReadonlyArray<LaneRun>, elapsedMs: number): Array<LaneSummary> {
	const byLane = new Map<number, LaneSummary>();

	for (const run of runs) {
		const entry = byLane.get(run.lane) ?? { batches: [], busyMs: 0, idleMs: 0, lane: run.lane };
		entry.batches.push({ batch: run.batch, elapsedMs: run.elapsedMs, profile: run.profile });
		entry.busyMs += run.elapsedMs;
		byLane.set(run.lane, entry);
	}

	for (const entry of byLane.values()) {
		entry.idleMs = Math.max(0, elapsedMs - entry.busyMs);
	}

	return [...byLane.values()].sort((left, right) => left.lane - right.lane);
}

/** Emits the pool's own summary: what ran, how long, and how much of it was actually parallel. */
function reportPool(options: CliOptions, pool: PoolResult): void {
	const ran = pool.batches.length;
	const elapsedMs = pool.elapsedMs ?? 0;
	const saturatedMs = pool.saturatedMs ?? 0;
	const idleReasons = pool.idleReasons ?? [];
	const lanes = pool.lanes ?? [];
	const utilization =
		elapsedMs === 0 ? 0 : Math.min(100, Math.round((saturatedMs / elapsedMs) * 100));

	if (options.jsonOut === true) {
		emitJson({
			batches: pool.batches,
			elapsedMs,
			failures: pool.failures.map((failure) => failure.batch),
			idleReasons,
			kind: "pool",
			lanes,
			saturatedMs,
			utilization,
		});
		return;
	}

	emitText(
		options,
		`\n  ── ${String(ran)} batch(es) in ${formatElapsed(elapsedMs)} · ${String(utilization)}% of lanes busy ──`,
	);
	for (const run of [...pool.completed, ...pool.failures].sort((a, b) => a.lane - b.lane)) {
		const mark = run.error === undefined ? "✓" : "✗";
		const suffix = run.error === undefined ? "" : " — failed";
		emitText(
			options,
			`    ${mark} ${run.batch} [${run.profile}] ${formatElapsed(run.elapsedMs)}${suffix}`,
		);
	}

	/*
	 * Only worth a line when the lanes actually differ: one batch per lane is the list above again,
	 * and a single-lane pool has nothing to compare against.
	 */
	const spread = lanes.length > 1 && lanes.some((lane) => lane.batches.length > 1);
	if (spread) {
		for (const lane of lanes) {
			const names = lane.batches.map((batch) => batch.batch).join(", ");
			emitText(
				options,
				`    lane ${String(lane.lane)}: ${formatElapsed(lane.busyMs)} busy · ${formatElapsed(lane.idleMs)} idle · ${String(lane.batches.length)} batch(es): ${names}`,
			);
		}
	}

	if (idleReasons.length > 0) {
		emitText(
			options,
			`    ⏸ ${formatElapsed(elapsedMs - saturatedMs)} with a lane free: ${idleReasons.join(" · ")}`,
		);
	}
}

/** Human duration, e.g. `2h14m` or `47s`. */
function formatElapsed(ms: number): string {
	const totalSeconds = Math.round(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${String(hours)}h${String(minutes).padStart(2, "0")}m`;
	}

	if (minutes > 0) {
		return `${String(minutes)}m${String(seconds).padStart(2, "0")}s`;
	}

	return `${String(seconds)}s`;
}

function indent(text: string): string {
	return text
		.split(/\r?\n/u)
		.map((line) => `    ${line}`)
		.join("\n");
}

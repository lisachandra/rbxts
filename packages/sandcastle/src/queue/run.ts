/*
 * Queue dispatch: `sandcastle queue run` and `queue bootstrap`.
 *
 * `run` fires the first READY sequence, then re-reads the manifest and re-fetches live GitHub state
 * before picking the next one — that re-read is what lets a review's follow-ups, gate promotions, or
 * newly-filed issues change what runs next inside the same command. Gates are never fired; a
 * serialization rule (`R<n>`) that an already-dispatched issue participates in blocks a sequence.
 *
 * The invocation holds `runLockName` for its whole lifetime. That is what makes the in-memory `seen`
 * set a *complete* view of what this checkout has in flight: two dispatchers cannot overlap, so a
 * numbered rule cannot be broken by a second `queue run` starting halfway through the first.
 * Mutations deliberately ignore that lock, so a review running inside a batch can still register the
 * follow-ups it files.
 *
 * Dispatch resumes by default. A sequence that grew a new tail member re-fires the whole batch, and
 * `sequential.ts` skips the members that already completed with an APPROVED review while chaining
 * their branch as the next base — dropping landed members here instead would break that chaining.
 * `--no-resume` forces a clean re-run of every member.
 */

import type { CliOptions } from "../cli.js";
import type { AgentProfile } from "../config.js";
import { config, io } from "../runtime.js";
import { runSequentialIssues } from "../sequential.js";
import { getLatestReviewMarker, isIssueComplete } from "../state.js";
import { applyBootstrap, promotableGates, proposeBootstrap } from "./bootstrap.js";
import { inspectChainSequences } from "./chain.js";
import { sequenceGateNames, unmetIntegrationGates } from "./gates.js";
import { runQueueLand } from "./land.js";
import { acquireDispatchLease, type LeaseHandle } from "./lease.js";
import { fetchLiveQueueState, type LiveQueueState } from "./live.js";
import { acquireQueueLock, batchLockName, runLockName } from "./lock.js";
import { type QueueManifest, readQueueManifest, referencedIssues } from "./manifest.js";
import { clearAfterReferences, deleteSequence, promoteIssue, removeIssue } from "./mutations.js";
import { emitJson, emitText } from "./output.js";
import { transactQueueManifest } from "./persist.js";
import { isLaneChild, type PoolResult, runParallelPool } from "./pool.js";
import { profileByName, profileForLane, resolveLaneAgents } from "./profile.js";
import { computeQueueView } from "./render.js";
import { pendingMembers, selectNextBatch, sequenceTail } from "./schedule.js";

/**
 * Dispatch seam: production runs the sequential workflow, tests inject a stub.
 *
 * @param name - The batch being fired, so the live dispatch can re-read its member order.
 * @param issues - The fire-time member order.
 * @param remaining - Members still allowed under `--max-issues` after prior batches.
 * @returns Every member actually processed — dispatched or reuse-skipped, including members the
 *   batch grew mid-run — so the caller's `seen` set and budget stay truthful.
 */
export type QueueDispatch = (
	name: string,
	issues: Array<string>,
	options: CliOptions,
	resume: boolean,
	remaining?: number,
) => Promise<ReadonlyArray<string>>;

const defaultDispatch: QueueDispatch = async (name, issues, options, resume, remaining) => {
	const results = await runSequentialIssues(
		issues,
		options.base,
		options.model,
		options.effort,
		options.agentBackend,
		resume,
		{
			...(remaining !== undefined ? { budget: remaining } : {}),
			/*
			 * Under `--json` stdout is the machine channel, so setup chatter goes to stderr like
			 * every other human line in this command group.
			 */
			emit: options.jsonOut ? console.error : undefined,
			ignoreSetup: options.ignoreSetup,
			/*
			 * Live dispatch: the runner re-reads this batch's member order before each member, so a
			 * follow-up a review registers mid-run dispatches next, chained from the member whose
			 * review filed it — not on a re-fire replay that chains past the insertion.
			 */
			nextOrder: () =>
				readQueueManifest().sequences.find((entry) => entry.name === name)?.issues,
			pushAndDelete: options.pushAndDelete === true,
			setupOutput: options.setupOutput,
			skipSetup: options.skipSetup,
			steps: options.steps,
			strictChain: options.strictChain === true || config.queue.strictChain === true,
		},
	);
	return results.map((result) => result.issue);
};

export interface QueueRunDeps {
	/** Replaces chain-drift computation for one invocation. */
	chain?: QueueChain;
	/** Replaces the sequential workflow for one invocation. */
	dispatch?: QueueDispatch;
	/** Replaces the hand-off attempt for one invocation. */
	land?: QueueLand;
	/** Replaces the parallel lane pool for one invocation. */
	pool?: QueuePool;
}

/** Lane-pool seam: production runs one child per batch, tests inject the outcome. */
export type QueuePool = (options: CliOptions) => Promise<PoolResult>;

/** Chain-drift seam: production walks member branches with git ancestry, tests inject lines. */
export type QueueChain = (manifest: QueueManifest) => Array<string>;

/** Fetches the ready backlog, then the blocked-by edges for exactly those issues. */
function loadBacklogLive(): LiveQueueState {
	const backlog = fetchLiveQueueState({
		numbers: new Set<string>(),
		readyLabel: config.labels.readyForAgent,
	});
	return fetchLiveQueueState({
		numbers: new Set(backlog.readyIssues.map((issue) => issue.number)),
		readyLabel: config.labels.readyForAgent,
	});
}

/** Proposes — or with `--apply` writes — queue placements for the open ready backlog. */
export function runQueueBootstrap(options: CliOptions): void {
	/*
	 * Two passes: the first page yields the ready backlog, the second supplies blocked-by edges for
	 * exactly those numbers, because `fetchLiveQueueState` only fetches edges for the numbers it is
	 * handed.
	 */
	const live = loadBacklogLive();
	const proposal = proposeBootstrap({ live, manifest: readQueueManifest() });
	if (options.jsonOut) {
		emitJson(proposal);
	}

	emitText(
		options,
		`  Proposal: ${proposal.sequences.length} sequence(s), ${proposal.gated.length} gate(s), ${proposal.human.length} human item(s)`,
	);
	for (const sequence of proposal.sequences) {
		emitText(options, `    ${sequence.name}: ${sequence.issues.join(", ")}`);
	}

	if (options.queueApply !== true) {
		emitText(options, "  (proposal only — pass --apply to write it)");
		return;
	}

	transactQueueManifest(options, (manifest) => {
		// Proposed again inside the lock so a concurrent write cannot be applied against stale state.
		const applied = proposeBootstrap({ live, manifest });
		return {
			message: `  ✓ Applied bootstrap: ${applied.sequences.length} sequence(s)`,
			next: applyBootstrap(manifest, applied),
			summary: "bootstrap the queue",
		};
	});
}

/** Whether an issue landed: every phase complete and the review approved. */
function isLanded(issue: string): boolean {
	return isIssueComplete(issue) && getLatestReviewMarker(issue) === "APPROVED";
}

/** What one batch's hand-off attempt produced. */
export interface LandOutcome {
	/** Failure text, present only when the hand-off failed. */
	error?: string;
	ok: boolean;
}

/** Hand-off seam: production composes and hands the batch over, tests inject the outcome. */
export type QueueLand = (options: CliOptions, name: string) => Promise<LandOutcome>;

/** One batch whose hand-off failed. */
interface HandOffFailure {
	batch: string;
	error: string;
}

/** What one `queue run` invocation did; the exit code is decided from it in one place. */
interface QueueRunSummary {
	/**
	 * Batches whose execution failed, in completion order.
	 *
	 * Distinct from {@link failures}: a failed dispatch means the work did not happen, which is a
	 * different report from a finished batch whose pull request could not be composed.
	 */
	dispatchFailures?: Array<HandOffFailure>;
	/** Hand-offs that failed, in dispatch order. */
	failures: Array<HandOffFailure>;
	/** Whether the loop stopped because nothing was runnable. */
	nothingToRun: boolean;
}

/**
 * - Lands a freshly dispatched batch when `--land` asked for it.
 * - @param options - Parsed CLI options; `--create-pr` decides whether the PR is opened or printed.
 * - @param name - Batch name to compose and hand over.
 * - @returns Whether the hand-off completed; a failure is recorded and fails the invocation.
 * - @remarks A failed land does not stop the invocation: the integration manifest keeps the failure
 *   and the loop moves to the next batch that is not gated on it, so one blocked composition cannot
 *   strand the rest of the queue. It reports the failure instead, because a batch whose hand-off
 *   failed is still open on GitHub.
 */
async function landBatch(options: CliOptions, name: string): Promise<LandOutcome> {
	try {
		await runQueueLand({ ...options, integrationName: name });
		return { ok: true };
	} catch (err) {
		const error = String(err);
		emitText(options, `  ⚠ Could not land "${name}": ${error}`);
		emitText(
			options,
			`    Inspect it with \`pnpm sandcastle integration-status --name ${name}\`, then retry with \`pnpm sandcastle queue land --name ${name}\`.`,
		);
		return { error, ok: false };
	}
}

/** Members of every batch that GitHub has closed: the batch has landed and they can leave. */
function closedMembers(manifest: QueueManifest, live: LiveQueueState): Array<string> {
	return manifest.sequences
		.flatMap((sequence) => sequence.issues)
		.filter((issue) => live.issues.get(issue)?.state === "CLOSED");
}

/**
 * - Removes members GitHub has closed, so a landed batch stops being drift.
 * - @param options - Parsed CLI options; `--dry-run` reports without writing.
 * - @param closed - Member numbers to remove, from {@link closedMembers}.
 * - @remarks Keyed on the merge, never on a completed hand-off. A composed batch keeps its members —
 *   and its place in the queue — until the pull request actually lands, so a pull request that is
 *   still open, or that is closed without merging, leaves the batch intact and recoverable instead
 *   of deleting its only record. A batch whose members are gone cannot stay in the manifest (an
 *   empty batch is drift) and nothing waits on it any more, so its `after` gates are cleared rather
 *   than left to dangle.
 */
function pruneClosed(options: CliOptions, closed: ReadonlyArray<string>): void {
	transactQueueManifest(options, (manifest) => {
		let next = manifest;
		const removed: Array<string> = [];
		for (const issue of closed) {
			try {
				next = removeIssue(next, issue);
				removed.push(issue);
			} catch {
				// Already absent; nothing to prune.
			}
		}

		if (removed.length === 0) {
			return { next: manifest, summary: "prune landed" };
		}

		const emptied = next.sequences
			.filter((sequence) => sequence.issues.length === 0)
			.map((sequence) => sequence.name);
		for (const name of emptied) {
			next = clearAfterReferences(next, name);
			next = deleteSequence(next, name);
		}

		return {
			message: `  ✓ Pruned landed issue(s): ${removed.join(", ")}`,
			next,
			summary: `prune landed ${removed.join(", ")}`,
		};
	});
}

/**
 * Fires ready sequences until nothing is runnable, the budget is spent, or a batch fails.
 *
 * Exits 1 when nothing could fire, and 2 when a hand-off failed, so a scripted caller can tell an
 * exhausted queue from a batch that needs a human.
 *
 * @param options - Parsed CLI options.
 * @param deps - Dispatch seam; defaults to the sequential workflow.
 * @rejects {Error} When no model is configured, another dispatcher holds the run lock, or a batch's
 * sequential run fails.
 */
export async function runQueueRun(options: CliOptions, deps: QueueRunDeps = {}): Promise<void> {
	if (options.queueOnce === true) {
		await runQueueOnce(options, deps.dispatch ?? defaultDispatch);
		return;
	}

	if ((options.queueParallel ?? config.queue.parallel) > 1) {
		await runQueueParallel(options, deps);
		return;
	}

	// A serial run applies the first lane's profile, so a batch never runs on a model the lanes don't.
	const profile = profileForLane(config.agents.catalog, 0);
	const resolved = profile === undefined ? options : withLaneAgents(options, profile);

	assertModels(resolved);

	/*
	 * The lease is taken before the local lock so the two are never held in the opposite order, and
	 * released after the loop because a serial run's landing is inside it. A dry run predicts and
	 * writes nothing, so it neither needs nor should take a remote lock a human might then have to
	 * clear.
	 */
	const lease = leaseFor(options);
	const release = acquireQueueLock({ name: runLockName });
	let summary: QueueRunSummary;
	try {
		summary = await runQueueLoop(
			resolved,
			deps.chain,
			deps.dispatch ?? defaultDispatch,
			deps.land ?? landBatch,
			lease.lost,
		);
	} finally {
		release();
		lease.release();
	}

	reportQueueRun(resolved, summary);
}

/**
 * - Acquires the cross-machine lease when this invocation dispatches, or a no-op handle when it does
 *   not.
 * - @param options - Parsed CLI options; `--no-lease` and `--lease-strict` override the config.
 * - @returns A handle whose `release` is safe to call unconditionally.
 * - @remarks A `--dry-run` takes no lease: it has no work to protect, and a lease held by a run that
 *   dispatches nothing would only make a real run refuse. `--once` is a lane child whose parent
 *   already holds the lease, so taking one there would deadlock against itself.
 */
function leaseFor(options: CliOptions): LeaseHandle {
	if (options.dryRun === true || options.queueOnce === true) {
		return { kind: "local", lost: () => false, release: () => undefined };
	}

	const mode =
		options.queueLease === undefined
			? config.queue.lease
			: options.queueLease
				? "strict"
				: "off";
	const lease = acquireDispatchLease({ mode });
	if (lease.kind === "lease") {
		emitText(options, "  ✓ Dispatch lease held");
	}

	return lease;
}

/**
 * - Overlays a catalog profile's model and harness onto a run's options.
 * - @param options - Parsed CLI options.
 * - @param profile - The profile this lane runs.
 * - @returns Options whose workflow default and per-step map come from that profile.
 * - @remarks `runSequentialIssues` needs no new parameter: everything it reads about the model
 *   arrives through these fields, so a lane differs from a serial run only in what this returns.
 */
function withLaneAgents(options: CliOptions, profile: AgentProfile): CliOptions {
	const lane = resolveLaneAgents(config, profile, options.steps);
	return {
		...options,
		agentBackend: lane.agentBackend,
		effort: lane.effort,
		model: lane.model,
		steps: { ...options.steps, ...lane.steps },
	};
}

/**
 * - Runs exactly one batch and stops.
 * - @param options - Parsed CLI options; `--name` names the batch.
 * - @param dispatch - The sequential workflow.
 * - @throws {Error} When `--name` does not name a batch in the manifest, or the resolved steps name
 *   no model.
 * - @remarks This is a `--parallel` lane's entry point. It deliberately skips pruning, gate
 *   promotion, and the hand-off: the parent owns the queue, and a child that landed its own batch
 *   would compose the same integration twice. A child exits 0 on completion, because "the batch
 *   finished" is success here — the serial loop reports exit 1 for a batch that leaves nothing
 *   further to fire, which is the opposite of what a lane means.
 *
 * @rejects {Error} When the batch's sequential run fails or a member is blocked.
 */
async function runQueueOnce(options: CliOptions, dispatch: QueueDispatch): Promise<void> {
	const name = options.integrationName ?? "";
	const sequence = readQueueManifest().sequences.find((entry) => entry.name === name);
	if (sequence === undefined) {
		throw new Error(`--once names batch "${name}", which the queue manifest does not define.`);
	}

	if (sequence.issues.length === 0) {
		emitText(options, `  ⏹ Batch "${name}" has no members.`);
		return;
	}

	const profile = profileOf(options);
	const resolved = profile === undefined ? options : withLaneAgents(options, profile);
	assertModels(resolved);

	const release = acquireQueueLock({ name: batchLockName(name) });
	try {
		const processed = await dispatch(
			name,
			sequence.issues,
			resolved,
			options.noResume !== true,
			options.maxIssues,
		);
		if (options.jsonOut === true) {
			emitJson({ batch: name, issues: processed, kind: "once" });
		}
	} finally {
		release();
	}
}

/** The profile a run should execute with: `--profile`, else lane 0 of the catalog. */
function profileOf(options: CliOptions): undefined | AgentProfile {
	return (
		profileByName(config.agents.catalog, options.queueProfile) ??
		profileForLane(config.agents.catalog, 0)
	);
}

/**
 * - Refuses a run whose resolved steps name no model.
 * - @param options - Parsed CLI options, with any lane profile already applied.
 * - @throws {Error} Naming the backend and the config key that would fix it.
 * - @remarks Checked here rather than in `parseArgs` because the model can come from a catalog
 *   profile, which parsing does not resolve.
 */
function assertModels(options: CliOptions): void {
	for (const step of Object.values(options.steps)) {
		if (step.model === "") {
			throw new Error(
				`No model configured for ${step.agentBackend} (queue run); set agents.models.${step.agentBackend}, add an agents.catalog profile, or pass --model <model>.`,
			);
		}
	}
}

/**
 * - Runs ready batches through the lane pool and reports the outcome.
 * - @param options - Parsed CLI options.
 * - @param deps - Seams for the tests.
 * - @remarks The parent holds `runLockName` for the whole pool, exactly as the serial loop does: that
 *   is what keeps a second dispatcher from reserving a batch a lane is already running. Each child
 *   additionally takes its own batch lock. Landing is serial and in completion order, so a failed
 *   composition is recorded and the remaining lanes are unaffected.
 *
 * @rejects {Error} When this process is a lane child, which must never open a second pool.
 */
async function runQueueParallel(options: CliOptions, deps: QueueRunDeps): Promise<void> {
	/*
	 * A lane child must never fan out again. `--once` is what keeps a child single-batch, but the
	 * marker is the guard: if the flag were ever forwarded or dropped, a child holding `--parallel`
	 * would spawn grandchildren competing for the same manifest and the same worktrees.
	 */
	if (isLaneChild()) {
		throw new Error(
			"This process is a --parallel lane child and cannot run a pool of its own; lanes spawn from the parent only.",
		);
	}

	/*
	 * The lease spans the pool *and* the serial landing: landing pushes member branches and opens a
	 * pull request, which is exactly the work a second dispatcher must not duplicate.
	 */
	const lease = leaseFor(options);
	const land = deps.land ?? landBatch;
	let pool: Awaited<ReturnType<typeof runParallelPool>>;
	const release = acquireQueueLock({ name: runLockName });
	try {
		pool = await (
			deps.pool ?? ((poolOptions) => runParallelPool(poolOptions, undefined, lease.lost))
		)(options);
	} finally {
		release();
	}

	const dispatchFailures: Array<HandOffFailure> = pool.failures.map((failure) => ({
		batch: failure.batch,
		error: failure.error ?? "",
	}));
	const landFailures: Array<HandOffFailure> = [];

	try {
		/*
		 * Land after the pool, serially, over the batches that finished cleanly. A batch whose lane
		 * failed is left alone: its composition would describe a partial chain.
		 */
		if (options.land === true) {
			for (const run of pool.completed) {
				const outcome = await land(options, run.batch);
				if (options.jsonOut === true) {
					emitJson({
						handOff: { batch: run.batch, error: outcome.error, ok: outcome.ok },
					});
				}

				if (!outcome.ok) {
					landFailures.push({ batch: run.batch, error: outcome.error ?? "" });
				}
			}
		}
	} finally {
		lease.release();
	}

	reportQueueRun(options, {
		dispatchFailures,
		failures: landFailures,
		nothingToRun: pool.batches.length === 0,
	});
}

/**
 * - Turns a loop summary into the invocation's exit code.
 * - @param options - Parsed CLI options.
 * - @param summary - What the loop did.
 * - @remarks Exit 1 when nothing could fire: "nothing can fire" is a failure for a dispatcher, and a
 *   typo in `--name` and an exhausted queue both need to be visible to whatever scripted the run.
 *   Exit 2 when a hand-off failed, which is the one case 1 would misreport: the batch needs a human
 *   before the queue moves on.
 */
function reportQueueRun(options: CliOptions, summary: QueueRunSummary): void {
	const dispatchFailures = summary.dispatchFailures ?? [];
	if (summary.failures.length === 0 && dispatchFailures.length === 0) {
		if (summary.nothingToRun) {
			io.exit(1);
		}

		return;
	}

	/*
	 * A dispatch failure is reported before a hand-off failure: the work never landed, so a reader needs
	 * to know that first. `--json` gets one object per failed batch, keyed so a consumer can tell the
	 * two apart without inferring it from the order.
	 */
	if (options.jsonOut) {
		const failures = [
			...dispatchFailures.map((failure) => ({ ...failure, kind: "dispatch" })),
			...summary.failures.map((failure) => ({ ...failure, kind: "handOff" })),
		];
		emitJson({ failures, handOff: summary.failures.length > 0 ? "failed" : undefined });
	} else {
		if (dispatchFailures.length > 0) {
			const names = dispatchFailures.map((failure) => failure.batch).join(", ");
			emitText(options, `  ✗ ${dispatchFailures.length} batch failure(s): ${names}`);
			for (const failure of dispatchFailures) {
				emitText(options, `    ${failure.batch}: ${failure.error}`);
			}

			emitText(
				options,
				"    Re-run the failed batch with `pnpm sandcastle queue run --name <batch>`.",
			);
		}

		if (summary.failures.length > 0) {
			const names = summary.failures.map((failure) => failure.batch).join(", ");
			emitText(options, `  ✗ ${summary.failures.length} hand-off failure(s): ${names}`);
			for (const failure of summary.failures) {
				emitText(options, `    ${failure.batch}: ${failure.error}`);
			}

			emitText(options, "    Retry with `pnpm sandcastle queue land --name <batch>`.");
		}
	}

	io.exit(summary.failures.length > 0 ? 2 : 1);
}

/** The dispatch loop itself, with the lock already held, reporting what it did. */
async function runQueueLoop(
	options: CliOptions,
	chain: undefined | QueueChain,
	dispatch: QueueDispatch,
	land: QueueLand,
	leaseLost: () => boolean = () => false,
): Promise<QueueRunSummary> {
	const seen = new Set<string>();
	const failures: Array<HandOffFailure> = [];
	const resume = options.noResume !== true;
	let promotedGates = false;
	/** Batch dispatched immediately before the current iteration, if any. */
	let lastBatch: string | undefined;
	const maxIssues = options.maxIssues ?? Number.POSITIVE_INFINITY;
	let dispatched = 0;
	let warnedDrift = false;
	let prunedOnce = false;
	for (;;) {
		/*
		 * Checked between batches, never mid-batch: the batch already in flight must be allowed to
		 * finish, but starting another under a lease this checkout no longer holds is precisely the
		 * overlap the lease exists to prevent.
		 */
		if (leaseLost()) {
			emitText(
				options,
				"  ⏹ Another checkout took the dispatch lease; not starting another batch.",
			);
			return { failures, nothingToRun: false };
		}

		const manifest = readQueueManifest();
		const live = fetchLiveQueueState({
			numbers: referencedIssues(manifest),
			readyLabel: config.labels.readyForAgent,
		});

		/*
		 * Once per invocation, and before anything is selected: a member GitHub has closed has landed,
		 * so it leaves the manifest here. Keyed on the merge rather than on a completed hand-off, so a
		 * composed batch keeps its members — and its place in the queue — until the pull request
		 * actually lands. Pruning first also means the selection below sees the manifest the run will
		 * act on, rather than a batch that has already been emptied.
		 */
		if (!prunedOnce && options.queueKeepEntries !== true) {
			prunedOnce = true;
			const closed = closedMembers(manifest, live);
			if (closed.length > 0) {
				pruneClosed(options, closed);
				continue;
			}
		}

		const view = computeQueueView(manifest, live, {
			gates: unmetIntegrationGates({ names: sequenceGateNames(manifest) }),
			strictGates: true,
		});

		/*
		 * Chain containment is git state, which `computeQueueView` (pure over the manifest and GitHub)
		 * cannot see. A member branch that does not contain its predecessor's tip means the run order
		 * moved underneath members that already ran — the breaks are appended to the same drift list,
		 * so `--require-clean` refuses on them and the warn-once path reports them like any other
		 * drift.
		 */
		const chainLines = (chain ?? inspectChainSequences)(manifest);
		if (chainLines.length > 0) {
			view.drift.push(...chainLines);
		}

		/*
		 * Opt-in, and once per invocation: promoting gates changes what the queue will run unattended,
		 * and a helper that re-promoted its own output on every iteration would spin.
		 */
		if (options.queuePromoteGates === true && !promotedGates) {
			promotedGates = true;
			if (promoteGatesOnce(options, live) > 0) {
				continue;
			}
		}

		if (view.drift.length > 0) {
			if (options.queueRequireClean === true) {
				for (const line of view.drift) {
					emitText(options, `  ✗ ${line}`);
				}

				emitText(
					options,
					`  ✗ Queue drift: ${view.drift.length} problem(s); resolve them or drop --require-clean.`,
				);
				return { failures, nothingToRun: true };
			}

			if (!warnedDrift) {
				warnedDrift = true;
				emitText(
					options,
					`  ⚠ ${view.drift.length} drift item(s) — \`pnpm sandcastle queue check\` for details.`,
				);
			}
		}

		const pending = lastBatch === undefined ? [] : pendingMembers(view, lastBatch, seen);
		let decision = selectNextBatch({
			batch: options.integrationName,
			manifest,
			preferred: lastBatch,
			seen,
			view,
		});
		/*
		 * A batch that grew members while it ran has not finished: a review registered a follow-up into
		 * it. Stopping is the honest answer, because firing an unrelated batch first is exactly how a
		 * follow-up registered mid-run was passed over. --continue-anyway restores the fall-through.
		 */
		if (decision.kind === "done" && pending.length > 0 && lastBatch !== undefined) {
			if (options.continueAnyway !== true) {
				if (options.jsonOut) {
					emitJson({
						batch: lastBatch,
						decision: "stalled",
						pending,
						reason: decision.reason,
					});
				} else {
					emitText(options, `  ⏹ ${decision.reason}`);
					emitText(
						options,
						`    "${lastBatch}" is unfinished; inspect it with \`pnpm sandcastle queue list\`, or pass --continue-anyway to fire another batch.`,
					);
				}

				return { failures, nothingToRun: false };
			}

			emitText(
				options,
				`  ⚠ --continue-anyway: "${lastBatch}" still has ${pending.length} member(s) it cannot run.`,
			);
			decision = selectNextBatch({
				batch: options.integrationName,
				manifest,
				seen,
				view,
			});
		}

		if (decision.kind === "done") {
			if (options.jsonOut) {
				emitJson({ decision: "done", reason: decision.reason });
			} else {
				emitText(options, `  ⏹ Nothing to run: ${decision.reason}`);
			}

			return { failures, nothingToRun: true };
		}

		/*
		 * A sequence is atomic: each member's branch becomes the next member's base, so trimming one to
		 * fit the budget would break the chain. Refuse the batch instead of overrunning.
		 */
		if (dispatched + decision.issues.length > maxIssues) {
			emitText(
				options,
				`  ⏹ --max-issues ${maxIssues}: sequence "${decision.name}" (${decision.issues.length} issue(s)) exceeds the remaining budget (${maxIssues - dispatched}); stopping.`,
			);
			return { failures, nothingToRun: false };
		}

		if (options.jsonOut) {
			emitJson({ batch: decision.name, issues: decision.issues, kind: "sequence", resume });
		} else {
			const members = decision.issues.map((issue) => `#${issue}`).join(" → ");
			emitText(options, `\n▶ Firing sequence "${decision.name}": ${members}`);
			if (resume) {
				const landed = decision.issues.filter((issue) => isLanded(issue));
				if (landed.length > 0) {
					const skipped = landed.map((issue) => `#${issue}`).join(", ");
					emitText(
						options,
						`  ⏭ Resuming: ${skipped} already landed and will be skipped.`,
					);
				}
			}
		}

		if (options.dryRun) {
			emitText(options, "  (dry run — nothing dispatched)");
			return { failures, nothingToRun: false };
		}

		/*
		 * The dispatch processes the fire-time order live: members the batch grew mid-run (a review
		 * registering a follow-up) are dispatched by the same call, so the processed list — not the
		 * fire-time order — is what the `seen` set and the budget count.
		 */
		const processed = await dispatch(
			decision.name,
			decision.issues,
			options,
			resume,
			maxIssues - dispatched,
		);
		lastBatch = decision.name;

		for (const issue of processed) {
			seen.add(issue);
		}

		dispatched += processed.length;
		const landRequested = options.land === true;
		const outcome: LandOutcome = landRequested
			? await land(options, decision.name)
			: { ok: true };
		if (landRequested && options.jsonOut) {
			emitJson({ handOff: { batch: decision.name, error: outcome.error, ok: outcome.ok } });
		}

		if (!outcome.ok) {
			failures.push({ batch: decision.name, error: outcome.error ?? "" });
		}

		/*
		 * Read the manifest again: the hint has to describe the batch as it stands now, so a pruned or
		 * landed batch does not advertise a `queue land` that can no longer resolve its target.
		 */
		const sequence = readQueueManifest().sequences.find(
			(entry) => entry.name === decision.name,
		);
		if (sequence !== undefined) {
			emitText(
				options,
				`  Land hint: pnpm sandcastle queue land --name ${sequence.name} (tail #${sequenceTail(sequence.issues)})`,
			);
		}

		if (dispatched >= maxIssues) {
			emitText(options, `  ⏹ Reached --max-issues ${maxIssues}; stopping.`);
			return { failures, nothingToRun: false };
		}
	}
}

/** Promotes every promotable gate once, returning how many moved. */
function promoteGatesOnce(options: CliOptions, live: LiveQueueState): number {
	let promoted = 0;
	transactQueueManifest(options, (manifest) => {
		const promotions = promotableGates({ live, manifest });
		if (promotions.length === 0) {
			return { next: manifest, summary: "promote gates" };
		}

		let next = manifest;
		for (const promotion of promotions) {
			next = promoteIssue(next, promotion);
		}

		promoted = promotions.length;
		return {
			message: `  ✓ Promoted ${promotions.length} gate(s) into sequences.`,
			next,
			summary: `promote ${promotions.length} gate(s)`,
		};
	});

	return promoted;
}

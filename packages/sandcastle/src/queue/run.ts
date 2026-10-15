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
import { config, io } from "../runtime.js";
import { runSequentialIssues } from "../sequential.js";
import { getLatestReviewMarker, isIssueComplete } from "../state.js";
import { applyBootstrap, promotableGates, proposeBootstrap } from "./bootstrap.js";
import { sequenceGateNames, unmetIntegrationGates } from "./gates.js";
import { runQueueLand } from "./land.js";
import { fetchLiveQueueState, type LiveQueueState } from "./live.js";
import { acquireQueueLock, runLockName } from "./lock.js";
import { type QueueManifest, readQueueManifest, referencedIssues } from "./manifest.js";
import { clearAfterReferences, deleteSequence, promoteIssue, removeIssue } from "./mutations.js";
import { emitJson, emitText } from "./output.js";
import { transactQueueManifest } from "./persist.js";
import { computeQueueView } from "./render.js";
import { pendingMembers, selectNextBatch, sequenceTail } from "./schedule.js";

/** Dispatch seam: production runs the sequential workflow, tests inject a stub. */
export type QueueDispatch = (
	issues: Array<string>,
	options: CliOptions,
	resume: boolean,
) => Promise<void>;

const defaultDispatch: QueueDispatch = async (issues, options, resume) => {
	await runSequentialIssues(
		issues,
		options.base,
		options.model,
		options.effort,
		options.agentBackend,
		resume,
		{
			ignoreSetup: options.ignoreSetup,
			pushAndDelete: options.pushAndDelete === true,
			skipSetup: options.skipSetup,
			steps: options.steps,
		},
	);
};

export interface QueueRunDeps {
	/** Replaces the sequential workflow for one invocation. */
	dispatch?: QueueDispatch;
	/** Replaces the hand-off attempt for one invocation. */
	land?: QueueLand;
}

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
	for (const step of Object.values(options.steps)) {
		if (step.model === "") {
			throw new Error(
				`No model configured for ${step.agentBackend} (queue run); set agents.models.${step.agentBackend} or pass --model <model>.`,
			);
		}
	}

	const release = acquireQueueLock({ name: runLockName });
	let summary: QueueRunSummary;
	try {
		summary = await runQueueLoop(
			options,
			deps.dispatch ?? defaultDispatch,
			deps.land ?? landBatch,
		);
	} finally {
		release();
	}

	reportQueueRun(options, summary);
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
	if (summary.failures.length === 0) {
		if (summary.nothingToRun) {
			io.exit(1);
		}

		return;
	}

	if (options.jsonOut) {
		emitJson({ failures: summary.failures, handOff: "failed" });
	} else {
		const names = summary.failures.map((failure) => failure.batch).join(", ");
		emitText(options, `  ✗ ${summary.failures.length} hand-off failure(s): ${names}`);
		for (const failure of summary.failures) {
			emitText(options, `    ${failure.batch}: ${failure.error}`);
		}

		emitText(options, "    Retry with `pnpm sandcastle queue land --name <batch>`.");
	}

	io.exit(2);
}

/** The dispatch loop itself, with the lock already held, reporting what it did. */
async function runQueueLoop(
	options: CliOptions,
	dispatch: QueueDispatch,
	land: QueueLand,
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

		await dispatch(decision.issues, options, resume);
		lastBatch = decision.name;

		for (const issue of decision.issues) {
			seen.add(issue);
		}

		dispatched += decision.issues.length;
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

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
import { fetchLiveQueueState, type LiveQueueState } from "./live.js";
import { acquireQueueLock, runLockName } from "./lock.js";
import { readQueueManifest, referencedIssues } from "./manifest.js";
import { promoteIssue, removeIssue } from "./mutations.js";
import { emitJson, emitText } from "./output.js";
import { transactQueueManifest } from "./persist.js";
import { computeQueueView } from "./render.js";
import { selectNextBatch, sequenceTail } from "./schedule.js";

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
		undefined,
		options.ignoreSetup,
		options.skipSetup,
		options.steps,
	);
};

export interface QueueRunDeps {
	/** Replaces the sequential workflow for one invocation. */
	dispatch?: QueueDispatch;
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

/** Removes completed, APPROVED members so `queue check` stays green after a batch lands. */
function pruneLanded(issues: ReadonlyArray<string>, options: CliOptions): void {
	const landed = issues.filter((issue) => isLanded(issue));
	if (landed.length === 0) {
		return;
	}

	transactQueueManifest(options, (manifest) => {
		let next = manifest;
		for (const issue of landed) {
			try {
				next = removeIssue(next, issue);
			} catch {
				// Already absent; nothing to prune.
			}
		}

		return {
			message: `  ✓ Pruned landed issue(s): ${landed.join(", ")}`,
			next,
			summary: `prune landed ${landed.join(", ")}`,
		};
	});
}

/**
 * Fires ready sequences until nothing is runnable, the budget is spent, or a batch fails.
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
	try {
		await runQueueLoop(options, deps.dispatch ?? defaultDispatch);
	} finally {
		release();
	}
}

/** The dispatch loop itself, with the lock already held. */
async function runQueueLoop(options: CliOptions, dispatch: QueueDispatch): Promise<void> {
	const seen = new Set<string>();
	const resume = options.noResume !== true;
	let promotedGates = false;
	const maxIssues = options.maxIssues ?? Number.POSITIVE_INFINITY;
	let dispatched = 0;
	let warnedDrift = false;
	for (;;) {
		const manifest = readQueueManifest();
		const live = fetchLiveQueueState({
			numbers: referencedIssues(manifest),
			readyLabel: config.labels.readyForAgent,
		});
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
				io.exit(1);
				return;
			}

			if (!warnedDrift) {
				warnedDrift = true;
				emitText(
					options,
					`  ⚠ ${view.drift.length} drift item(s) — \`pnpm sandcastle queue check\` for details.`,
				);
			}
		}

		const decision = selectNextBatch({
			batch: options.integrationName,
			manifest,
			seen,
			view,
		});
		if (decision.kind === "done") {
			if (options.jsonOut) {
				emitJson({ decision: "done", reason: decision.reason });
			} else {
				emitText(options, `  ⏹ Nothing to run: ${decision.reason}`);
			}

			/*
			 * Exit 1: "nothing can fire" is a failure for a dispatcher — a typo in --name and an exhausted
			 * queue both need to be visible to whatever scripted the run.
			 */
			io.exit(1);
			return;
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
			return;
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
			return;
		}

		await dispatch(decision.issues, options, resume);

		for (const issue of decision.issues) {
			seen.add(issue);
		}

		dispatched += decision.issues.length;
		if (options.queueKeepEntries !== true) {
			pruneLanded(decision.issues, options);
		}

		const sequence = manifest.sequences.find((entry) => entry.name === decision.name);
		if (sequence?.mergeName !== undefined && sequence.mergeName !== "") {
			emitText(
				options,
				`  Merge hint: pnpm sandcastle merge --name ${sequence.mergeName} --issues ${sequenceTail(decision.issues)}`,
			);
		}

		if (dispatched >= maxIssues) {
			emitText(options, `  ⏹ Reached --max-issues ${maxIssues}; stopping.`);
			return;
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

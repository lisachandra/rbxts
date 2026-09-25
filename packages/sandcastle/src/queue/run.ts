/*
 * Queue dispatch: `sandcastle queue run` and `queue bootstrap`.
 *
 * `run` fires the first READY sequence, then re-reads the manifest and re-fetches live GitHub state
 * before picking the next one — that re-read is what lets a review's follow-ups, gate promotions, or
 * newly-filed issues change what runs next inside the same command. Gates are never fired; a
 * serialization rule (`R<n>`) that an already-dispatched issue participates in blocks a sequence.
 */

import type { CliOptions } from "../cli.js";
import { config } from "../runtime.js";
import { runSequentialIssues } from "../sequential.js";
import { getLatestReviewMarker, isIssueComplete } from "../state.js";
import { applyBootstrap, proposeBootstrap } from "./bootstrap.js";
import { fetchLiveQueueState } from "./live.js";
import { readQueueManifest, referencedIssues } from "./manifest.js";
import { removeIssue } from "./mutations.js";
import { persistQueueManifest } from "./persist.js";
import { computeQueueView } from "./render.js";
import { selectNextBatch, sequenceTail } from "./schedule.js";

/** Proposes — or with `--apply` writes — queue placements for the open ready backlog. */
export function runQueueBootstrap(options: CliOptions): void {
	const manifest = readQueueManifest();
	/*
	 * Two passes: the first page yields the ready backlog, the second supplies blocked-by edges for
	 * exactly those numbers, because `fetchLiveQueueState` only fetches edges for the numbers it is
	 * handed.
	 */
	const backlog = fetchLiveQueueState({
		numbers: new Set<string>(),
		readyLabel: config.labels.readyForAgent,
	});
	const live = fetchLiveQueueState({
		numbers: new Set(backlog.readyIssues.map((issue) => issue.number)),
		readyLabel: config.labels.readyForAgent,
	});
	const proposal = proposeBootstrap({ live, manifest });
	if (options.jsonOut) {
		console.log(JSON.stringify(proposal, undefined, 2));
	}

	const counts = `${proposal.sequences.length} sequence(s), ${proposal.gated.length} gate(s), ${proposal.human.length} human item(s)`;
	console.log(`  Proposal: ${counts}`);
	for (const sequence of proposal.sequences) {
		console.log(`    ${sequence.name}: ${sequence.issues.join(", ")}`);
	}

	if (options.queueApply !== true) {
		console.log("  (proposal only — pass --apply to write it)");
		return;
	}

	persistQueueManifest(applyBootstrap(manifest, proposal), "bootstrap the queue", options);
	console.log(`  ✓ Applied bootstrap: ${proposal.sequences.length} sequence(s)`);
}

/** Removes completed, APPROVED members so `queue check` stays green after a batch lands. */
function pruneLanded(issues: ReadonlyArray<string>, options: CliOptions): void {
	const manifest = readQueueManifest();
	const landed: Array<string> = [];
	for (const issue of issues) {
		if (isIssueComplete(issue) && getLatestReviewMarker(issue) === "APPROVED") {
			landed.push(issue);
		}
	}

	if (landed.length === 0) {
		return;
	}

	let next = manifest;
	for (const issue of landed) {
		try {
			next = removeIssue(next, issue);
		} catch {
			// Already absent; nothing to prune.
		}
	}

	persistQueueManifest(next, `prune landed ${landed.join(", ")}`, options);
	console.log(`  ✓ Pruned landed issue(s): ${landed.join(", ")}`);
}

/**
 * Fires ready sequences until nothing is runnable, the budget is spent, or a batch fails.
 *
 * @param options - Parsed CLI options.
 * @rejects {Error} When no model is configured, or a batch's sequential run fails.
 */
export async function runQueueRun(options: CliOptions): Promise<void> {
	for (const step of Object.values(options.steps)) {
		if (step.model === "") {
			throw new Error(
				`No model configured for ${step.agentBackend} (queue run); set agents.models.${step.agentBackend} or pass --model <model>.`,
			);
		}
	}

	const seen = new Set<string>();
	const maxIssues = options.maxIssues ?? Number.POSITIVE_INFINITY;
	let dispatched = 0;
	for (;;) {
		const manifest = readQueueManifest();
		const live = fetchLiveQueueState({
			numbers: referencedIssues(manifest),
			readyLabel: config.labels.readyForAgent,
		});
		const view = computeQueueView(manifest, live, { strictGates: true });
		const decision = selectNextBatch({
			batch: options.integrationName,
			manifest,
			seen,
			view,
		});
		if (decision.kind === "done") {
			console.log(`  ⏹ Nothing to run: ${decision.reason}`);
			return;
		}

		const members = decision.issues.map((issue) => `#${issue}`).join(" → ");
		console.log(`\n▶ Firing sequence "${decision.name}": ${members}`);
		if (options.dryRun) {
			console.log("  (dry run — nothing dispatched)");
			return;
		}

		await runSequentialIssues(
			decision.issues,
			options.base,
			options.model,
			options.effort,
			options.agentBackend,
			options.resume,
			undefined,
			options.ignoreSetup,
			options.skipSetup,
			options.steps,
		);

		for (const issue of decision.issues) {
			seen.add(issue);
		}

		dispatched += decision.issues.length;
		if (options.queueKeepEntries !== true) {
			pruneLanded(decision.issues, options);
		}

		const sequence = manifest.sequences.find((entry) => entry.name === decision.name);
		if (sequence?.mergeName !== undefined && sequence.mergeName !== "") {
			const tail = sequenceTail(decision.issues);
			console.log(
				`  Merge hint: pnpm sandcastle merge --name ${sequence.mergeName} --issues ${tail}`,
			);
		}

		if (dispatched >= maxIssues) {
			console.log(`  ⏹ Reached --max-issues ${maxIssues}; stopping.`);
			return;
		}
	}
}

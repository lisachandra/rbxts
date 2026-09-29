/*
 * Run-order gates: whether the integration a batch waits on has landed.
 *
 * `queue run` branches every batch from the base branch, so a batch that consumes an earlier
 * batch's commits is only safe once that batch's integration is an ancestor of it. That rule used
 * to be prose in `notes` (and an `R<n>` line nothing enforced, because the harness never reads
 * GitHub edges); it is manifest data now (`sequences[].after`) and this module is the single
 * place that answers whether the gate holds.
 *
 * Fail closed: a missing manifest, an unfinished composition, or a missing `headCommit` all read as
 * "not landed", because firing a batch early is the expensive mistake.
 */

import { gitTry } from "../git.js";
import { readIntegrationManifest } from "../integration/manifest.js";
import { config } from "../runtime.js";
import type { IntegrationManifest, IntegrationStatus } from "../types.js";
import type { QueueManifest } from "./manifest.js";

/** Composition states where the integration branch exists and no longer changes under the queue. */
const composedStatuses: ReadonlySet<IntegrationStatus> = new Set<IntegrationStatus>([
	"integrated",
	"ready-for-human-merge",
	"review-failed",
	"review-passed",
]);

export interface IntegrationGateParams {
	/** Base branch the queue branches from; defaults to `config.baseBranch`. */
	baseBranch?: string;
	/** Ancestor seam; defaults to `git merge-base --is-ancestor <commit> <ref>`. */
	isAncestor?: (commit: string, ref: string) => boolean;
	/** Integration names to evaluate. */
	names: Iterable<string>;
	/** Manifest reader seam; defaults to the on-disk integration manifest. */
	readManifest?: (name: string) => undefined | IntegrationManifest;
}

/**
 * - Every integration some sequence declares it is waiting on.
 * - @param manifest - The queue manifest.
 * - @returns The `after` names referenced by any sequence.
 */
export function sequenceGateNames(manifest: QueueManifest): Set<string> {
	const names = new Set<string>();
	for (const sequence of manifest.sequences) {
		if (sequence.after !== undefined) {
			names.add(sequence.after);
		}
	}

	return names;
}

/** The git exit status is the answer: `merge-base --is-ancestor` fails when it is not an ancestor. */
function defaultIsAncestor(commit: string, ref: string): boolean {
	return gitTry(["merge-base", "--is-ancestor", commit, ref]) !== undefined;
}

/**
 * - Why each declared run-order gate is not satisfied yet.
 * - @param params - Integration names plus the git and manifest seams, for testability.
 * - @returns A map of unmet integration name to the reason it blocks; a landed gate is absent.
 * - @remarks Absent means safe to fire, so the map passes straight into `computeQueueView(manifest,
 *   live, { gates })`.
 * - @example
 *
 *   ```ts
 *   const gates = unmetIntegrationGates({ names: sequenceGateNames(manifest) });
 *   gates.get("vfx-surface-work"); // waiting on integration "vfx-surface-work" ...
 *   ```
 */
export function unmetIntegrationGates(params: IntegrationGateParams): Map<string, string> {
	const base = params.baseBranch ?? config.baseBranch;
	const isAncestor = params.isAncestor ?? defaultIsAncestor;
	const readManifest = params.readManifest ?? ((name: string) => readIntegrationManifest(name));
	const unmet = new Map<string, string>();
	for (const name of params.names) {
		const manifest = readManifest(name);
		if (manifest === undefined) {
			unmet.set(name, `waiting on integration "${name}" - it has not been composed yet`);
			continue;
		}

		if (!composedStatuses.has(manifest.status)) {
			unmet.set(
				name,
				`waiting on integration "${name}" - composition status is ${manifest.status}`,
			);
			continue;
		}

		if (manifest.headCommit === undefined || !isAncestor(manifest.headCommit, base)) {
			unmet.set(name, `waiting on integration "${name}" to land on ${base} - merge it first`);
		}
	}

	return unmet;
}

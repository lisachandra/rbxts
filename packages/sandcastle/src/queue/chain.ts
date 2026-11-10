/*
 * Chain containment: whether each batch's member branches still chain in run order.
 *
 * Each member's branch is cut from the previous member's branch, so member N's branch must contain
 * member N-1's tip. A branch that does not means the run order moved underneath the members —
 * usually a follow-up inserted ahead of members that had already completed before live dispatch
 * picked registrations up mid-run. The composition still merges every branch in run order, so no
 * work is lost; the break means later members developed without the inserted work, and the
 * integration review should expect collisions where the branches overlap.
 *
 * Pure over injected seams, mirroring `gates.ts`: the walk never touches git or the filesystem, so
 * tests inject fakes and callers wire the real ones in one place.
 */

import { branchTip, isAncestor } from "../git.js";
import { readState } from "../state.js";
import type { QueueManifest } from "./manifest.js";

export interface ChainBreakParams {
	/** Resolves a branch to its tip commit, or `undefined` when the branch does not resolve. */
	branchTipOf: (branch: string) => string | undefined;
	/** Ancestor seam; defaults to `git merge-base --is-ancestor <commit> <ref>`. */
	isAncestor: (commit: string, ref: string) => boolean;
	/** Returns the member's branch, or `undefined` when it has none yet. */
	memberBranch: (issue: string) => string | undefined;
}

/**
 * - Names the first branch in each batch that does not contain its predecessor's tip.
 * - @param sequences - Batch member orders, in run order.
 * - @param params - The git and state seams, for testability.
 * - @returns One drift line per break; an empty array when every branch chains.
 * - @remarks Members without a resolvable branch (never dispatched, or the branch is gone) are
 *   skipped — there is nothing to chain from. The first member of a batch has no in-batch
 *   predecessor, so it is never a break.
 */
export function chainBreaks(
	sequences: ReadonlyArray<{ issues: ReadonlyArray<string>; name: string }>,
	params: ChainBreakParams,
): Array<string> {
	const lines: Array<string> = [];
	for (const sequence of sequences) {
		let previous: undefined | { branch: string; issue: string; tip: string };
		for (const member of sequence.issues) {
			const branch = params.memberBranch(member);
			const tip = branch === undefined ? undefined : params.branchTipOf(branch);
			if (branch === undefined || tip === undefined) {
				continue;
			}

			if (previous !== undefined && !params.isAncestor(previous.tip, tip)) {
				lines.push(
					`Chain break in batch "${sequence.name}": ${branch} (#${member}) does not contain ` +
						`${previous.branch} (#${previous.issue}) - a member inserted ahead of already-run ` +
						"members was bypassed, so later members develop without its work. Move it after " +
						"them (`pnpm sandcastle queue remove --issue " +
						`${member}\`, then \`pnpm sandcastle queue add --issue ${member} --sequence ` +
						`${sequence.name} --after <last run member>\`) or accept it and resolve the ` +
						"overlap at composition.",
				);
			}

			previous = { branch, issue: member, tip };
		}
	}

	return lines;
}

/**
 * - {@link chainBreaks} wired to the real seams: state-file branches and git tips/ancestry.
 * - @param manifest - The queue manifest.
 * - @returns Drift lines for every chain break across the manifest's batches.
 * - @remarks A member without a state file has no branch to check, so batches that never ran report
 *   nothing — this is detection for orders that moved underneath members that did.
 */
export function inspectChainSequences(manifest: QueueManifest): Array<string> {
	return chainBreaks(manifest.sequences, {
		branchTipOf: (branch) => branchTip(branch)?.commit,
		isAncestor,
		memberBranch: (issue) => readState(issue)?.branch,
	});
}

/*
 * Sequential issue workflow: runs a list of issues serially, chaining each
 * completed branch as the next base, and aborts if any review ends "blocked".
 */

import { existsSync } from "node:fs";

import {
	branchTip,
	checkoutBranch,
	dirtyPaths,
	ensureLocalBranch,
	git,
	issueBranch,
} from "./git.js";
import { runSingleIssue } from "./issue.js";
import { io, normalizedPath, worktreePathForBranch } from "./runtime.js";
import { getLatestReviewMarker, isIssueBlocked, isIssueComplete } from "./state.js";
import type { AgentBackend, AgentPhaseName, ResolvedAgentStep } from "./types.js";
import { pushThenRemoveWorktree } from "./worktree.js";

interface SequentialIssueResult {
	error?: string;
	issue: string;
	status: "ok" | "failed" | "blocked";
}

/** Trailing options for a sequential run, kept off the positional list it outgrew. */
export interface SequentialIssueOptions {
	ignoreSetup?: boolean;
	/**
	 * Push each member's branch and remove its worktree as soon as the member finishes.
	 *
	 * @remarks
	 *   The chain base is the branch, and `queue land` composes from a branch, so a finished
	 *   member's worktree is dead weight. Reclaiming it per member rather than per batch is what
	 *   keeps a long batch from holding every checkout at once — a 31-member batch otherwise
	 *   carries 31.
	 */
	pushAndDelete?: boolean;
	skipSetup?: boolean;
	steps?: Record<AgentPhaseName, ResolvedAgentStep>;
	worktree?: string;
}

function printSequentialWorkflowSummary(results: Array<SequentialIssueResult>): {
	blocked: number;
	failed: number;
	ok: number;
} {
	console.log(`\n${"=".repeat(80)}`);
	console.log("Sequential Workflow Summary");
	console.log("=".repeat(80));
	const ok = results.filter((r) => r.status === "ok").length;
	const blocked = results.filter((r) => r.status === "blocked").length;
	const failed = results.filter((r) => r.status === "failed").length;
	console.log(`✓ Completed: ${ok}`);
	console.log(`🚫 Blocked: ${blocked}`);
	console.log(`✗ Failed: ${failed}`);
	console.log();
	for (const result of results) {
		const icon = result.status === "ok" ? "✓" : result.status === "blocked" ? "🚫" : "✗";
		const msg = result.error !== undefined && result.error !== "" ? ` — ${result.error}` : "";
		console.log(`  ${icon} #${result.issue}${msg}`);
	}

	console.log(`${"=".repeat(80)}\n`);
	return { blocked, failed, ok };
}

/**
 * - Pushes a finished member's branch and removes its worktree.
 * - @param params - Issue, its branch, and the worktree to reclaim.
 * - @remarks Best-effort and never fatal: the member has already finished, so a cleanup that cannot
 *   run must not turn a passing member into a failure. The branch is pushed _before_ anything is
 *   removed, because the push is what makes the worktree disposable; a failed push leaves it in
 *   place. Uncommitted tracked paths also keep it — a review can leave corrections behind that only
 *   exist in the worktree, and discarding them silently is worse than holding the disk. Exported
 *   only so the push-before-remove ordering and the dirty guard can be pinned by a test;
 *   `processSequentialIssue` is the sole production caller.
 *
 * @internal
 */
export function reclaimMemberWorktree(params: {
	branch: string;
	issue: string;
	worktreePath: string;
}): void {
	const { branch, issue, worktreePath } = params;
	if (!existsSync(worktreePath)) {
		return;
	}

	/*
	 * Only a worktree this runner placed is disposable. A `--worktree <path>` run points at one the
	 * caller made (a paseo worktree, say), and removing that is not what "reclaim the member's
	 * worktree" means — `queue clean` refuses a foreign path for the same reason.
	 */
	if (normalizedPath(worktreePath) !== normalizedPath(worktreePathForBranch(branch))) {
		return;
	}

	const dirty = dirtyPaths(worktreePath);
	if (dirty.length > 0) {
		/*
		 * Still push: the committed work is the durable half of the reclaim, and the worktree is kept
		 * only because uncommitted corrections live nowhere else.
		 */
		try {
			git(["push", "-u", "origin", branch]);
		} catch (err) {
			console.warn(`   ⚠ Could not push ${branch} for #${issue}: ${String(err)}`);
			return;
		}

		console.warn(
			`   ⏭ Pushed ${branch}, kept the worktree for #${issue}: ${String(dirty.length)} uncommitted path(s); ` +
				"commit them, or drop them with `pnpm sandcastle queue clean --batch <name> --force`.",
		);
		return;
	}

	try {
		pushThenRemoveWorktree(branch, worktreePath);
		console.log(`   ⌫ Pushed ${branch} and removed the worktree for #${issue}.`);
	} catch (err) {
		console.warn(
			`   ⚠ Could not push ${branch} or remove its worktree; it is still at ${worktreePath}: ${String(err)}`,
		);
	}
}

async function processSequentialIssue({
	agentBackend,
	currentBase,
	effort,
	ignoreSetup,
	index,
	isLast,
	issueNumber,
	model,
	pushAndDelete,
	resume,
	skipSetup,
	steps,
	total,
	worktree,
}: {
	agentBackend: AgentBackend;
	currentBase: string;
	effort: string;
	ignoreSetup?: boolean;
	index: number;
	isLast: boolean;
	issueNumber: string;
	model: string;
	pushAndDelete: boolean;
	resume: boolean;
	skipSetup?: boolean;
	steps?: Record<AgentPhaseName, ResolvedAgentStep>;
	total: number;
	worktree?: string;
}): Promise<{ nextBase: string; result: SequentialIssueResult; stop: boolean }> {
	console.log(`\n[${index + 1}/${total}] Processing issue #${issueNumber}...`);

	const fallbackBranch = issueBranch(issueNumber);
	const branchName =
		worktree !== undefined && worktree !== ""
			? (checkoutBranch(worktree) ?? fallbackBranch)
			: fallbackBranch;
	const worktreePath = worktree ?? worktreePathForBranch(fallbackBranch);

	if (
		resume &&
		(worktree === undefined || worktree === "") &&
		isIssueComplete(issueNumber) &&
		getLatestReviewMarker(issueNumber) === "APPROVED"
	) {
		const tip = branchTip(branchName);
		if (tip !== undefined) {
			/*
			 * A landed member is skipped even when its worktree is gone: the branch is the durable
			 * artifact and the worktree is disposable, so a batch re-fired after `queue clean` chains
			 * this member's branch instead of re-running phases that already passed review. Nothing is
			 * checked out here — the next member is cut from this branch, never from this worktree —
			 * so recreating one would only undo the cleanup that asked for it. A branch that
			 * survives only on `origin` (a cleanup that pushed and dropped the local copy) is restored
			 * locally first, since the chain base has to resolve.
			 */
			const restored = !tip.local && ensureLocalBranch(branchName);
			console.log(
				`   ⏭ Issue #${issueNumber} already completed; reusing ${branchName}.${
					restored ? " Restored it from origin." : ""
				}`,
			);
			const nextBase = !isLast ? branchName : currentBase;
			if (!isLast) {
				console.log(`   Next base will be: ${nextBase}`);
			}

			return {
				nextBase,
				result: { issue: issueNumber, status: "ok" },
				stop: false,
			};
		}
	}

	if (currentBase.startsWith("sandcastle/")) {
		console.log(`   Using accumulated base: ${currentBase}`);
	} else {
		console.log(`   Base ref: ${currentBase}`);
	}

	try {
		await runSingleIssue(issueNumber, model, effort, {
			agentBackend,
			baseRef: currentBase,
			ignoreSetup,
			resume,
			skipSetup,
			...(steps ? { steps } : {}),
			worktree,
		});

		if (isIssueBlocked(issueNumber)) {
			console.error(`\n❌ Sequential workflow aborted at issue #${issueNumber} (blocked)`);
			return {
				nextBase: currentBase,
				result: { issue: issueNumber, status: "blocked" },
				stop: true,
			};
		}

		if (pushAndDelete) {
			reclaimMemberWorktree({ branch: branchName, issue: issueNumber, worktreePath });
		}

		console.log(`   ✓ Issue #${issueNumber} complete`);
		const nextBase = !isLast ? branchName : currentBase;
		if (!isLast) {
			console.log(`   Next base will be: ${nextBase}`);
		}

		return {
			nextBase,
			result: { issue: issueNumber, status: "ok" },
			stop: false,
		};
	} catch (err) {
		const worktreeFlag =
			worktree !== undefined && worktree !== "" ? ` --worktree ${worktree}` : "";
		console.error(`\n❌ Issue #${issueNumber} failed: ${err}`);
		console.error(
			`   Stopping sequential workflow. To resume, fix and run: pnpm sandcastle:issue -- --issue ${issueNumber} --resume${worktreeFlag}`,
		);
		return {
			nextBase: currentBase,
			result: { error: String(err), issue: issueNumber, status: "failed" },
			stop: true,
		};
	}
}

/**
 * Runs multiple issues sequentially, chaining each completed branch as the next base.
 *
 * @rejects {Error} When sequential issue processing fails or is blocked.
 */
export async function runSequentialIssues(
	issueNumbers: Array<string>,
	baseRef: string,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
	resume: boolean,
	options: SequentialIssueOptions = {},
): Promise<void> {
	if (issueNumbers.length === 0) {
		throw new Error("At least one issue number is required for sequential workflow");
	}

	const { ignoreSetup, pushAndDelete = false, skipSetup, steps, worktree } = options;
	console.log(`\n${"=".repeat(80)}`);
	console.log("Sequential Issue Workflow");
	console.log("=".repeat(80));
	console.log(`Issues: ${issueNumbers.join(" → ")}`);
	console.log(`Base: ${baseRef}`);
	console.log(`${"=".repeat(80)}\n`);

	const results: Array<SequentialIssueResult> = [];
	let currentBase = baseRef;

	for (let index = 0; index < issueNumbers.length; index++) {
		const issueNumber = issueNumbers[index];
		if (issueNumber === undefined) {
			continue;
		}

		const processed = await processSequentialIssue({
			agentBackend,
			currentBase,
			effort,
			ignoreSetup,
			index,
			isLast: index === issueNumbers.length - 1,
			issueNumber,
			model,
			pushAndDelete,
			resume,
			skipSetup,
			...(steps ? { steps } : {}),
			total: issueNumbers.length,
			worktree,
		});
		results.push(processed.result);
		currentBase = processed.nextBase;
		if (processed.stop) {
			break;
		}
	}

	const summary = printSequentialWorkflowSummary(results);
	if (summary.blocked > 0 || summary.failed > 0) {
		io.exit(1);
	}
}

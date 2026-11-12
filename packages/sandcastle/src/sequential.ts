/*
 * Sequential issue workflow: runs a list of issues serially, chaining each
 * completed branch as the next base, and aborts if any review ends "blocked".
 */

import { existsSync } from "node:fs";

import type { SetupOutput } from "./config.js";
import {
	branchTip,
	checkoutBranch,
	dirtyPaths,
	ensureLocalBranch,
	git,
	isAncestor,
	issueBranch,
} from "./git.js";
import { runSingleIssue } from "./issue.js";
import { io, normalizedPath, worktreePathForBranch } from "./runtime.js";
import { getLatestReviewMarker, isIssueBlocked, isIssueComplete } from "./state.js";
import type { AgentBackend, AgentPhaseName, ResolvedAgentStep } from "./types.js";
import type { EmitLine } from "./worktree.js";
import { pushThenRemoveWorktree } from "./worktree.js";

export interface SequentialIssueResult {
	error?: string;
	issue: string;
	/** True when the member was reuse-skipped (complete + APPROVED) rather than dispatched. */
	reused?: boolean;
	status: "ok" | "failed" | "blocked";
}

/** What one member's dispatch produced, shared by the runner and its test seam. */
export interface DispatchIssueResult {
	nextBase: string;
	result: SequentialIssueResult;
	stop: boolean;
}

/** One member's dispatch parameters, shared by the runner and its test seam. */
export interface SequentialIssueParams {
	agentBackend: AgentBackend;
	currentBase: string;
	effort: string;
	emit?: EmitLine;
	ignoreSetup?: boolean;
	index: number;
	isLast: boolean;
	issueNumber: string;
	model: string;
	pushAndDelete: boolean;
	resume: boolean;
	setupOutput?: SetupOutput;
	skipSetup?: boolean;
	steps?: Record<AgentPhaseName, ResolvedAgentStep>;
	strictChain?: boolean;
	total: number;
	worktree?: string;
}

/** Per-member processing seam: production runs the phase pipeline, tests stub it. */
export type DispatchIssue = (params: SequentialIssueParams) => Promise<DispatchIssueResult>;

/** Trailing options for a sequential run, kept off the positional list it outgrew. */
export interface SequentialIssueOptions {
	/**
	 * Remaining `--max-issues` budget for this batch. The live walk stops before it dispatches a
	 * member that would overshoot: the chain stays atomic, and a batch that grew members mid-run
	 * stops instead of running work nobody budgeted.
	 */
	budget?: number;
	/** Per-member processing; production runs the phase pipeline, tests inject a stub. */
	dispatchIssue?: DispatchIssue;
	/** Emits setup progress lines; `--json` callers pass a stderr sink. */
	emit?: EmitLine;
	ignoreSetup?: boolean;
	/**
	 * Live dispatch: the member order is re-read through this after every dispatched member, and
	 * the walk resumes from the last processed member. A follow-up a review registers into the
	 * batch mid-run is then picked up immediately, chained from the member whose review filed it —
	 * not on a re-fire replay, where the reuse path would chain past the insertion. Omitted by the
	 * direct `issue-sequence` command, whose explicit list is the intent.
	 */
	nextOrder?: () => undefined | Array<string>;
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
	setupOutput?: SetupOutput;
	skipSetup?: boolean;
	steps?: Record<AgentPhaseName, ResolvedAgentStep>;
	/** Abort instead of warn when a reused member's branch does not contain the accumulated base. */
	strictChain?: boolean;
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
export function reclaimMemberWorktree({
	branch,
	issue,
	worktreePath,
}: {
	branch: string;
	issue: string;
	worktreePath: string;
}): void {
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
	emit,
	ignoreSetup,
	index,
	isLast,
	issueNumber,
	model,
	pushAndDelete,
	resume,
	setupOutput,
	skipSetup,
	steps,
	strictChain,
	total,
	worktree,
}: SequentialIssueParams): Promise<DispatchIssueResult> {
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

			/*
			 * Chain rewind guard: reusing a member whose branch does not contain the accumulated base
			 * means a member was inserted ahead of already-run ones and the run never picked it up —
			 * chaining this branch as the next base silently rewinds past that insertion, and every
			 * later member builds without it. Live dispatch picks follow-ups up before this point, so
			 * reaching it means the order already shipped that way: warn by default (the composition
			 * still merges every branch in run order, and `queue check` names the break as drift),
			 * abort under --strict-chain.
			 */
			const baseTip = currentBase.startsWith("sandcastle/")
				? branchTip(currentBase)?.commit
				: undefined;
			if (
				baseTip !== undefined &&
				baseTip !== tip.commit &&
				!isAncestor(baseTip, tip.commit)
			) {
				const message =
					`Reusing ${branchName} for #${issueNumber} rewinds the chain: it does not contain ` +
					`${currentBase}, so later members build without the member inserted ahead of this one.`;
				if (strictChain === true) {
					console.error(`   ✗ ${message}`);
					return {
						nextBase: currentBase,
						result: { error: message, issue: issueNumber, status: "failed" },
						stop: true,
					};
				}

				console.warn(`   ⚠ ${message}`);
			}

			const nextBase = !isLast ? branchName : currentBase;
			if (!isLast) {
				console.log(`   Next base will be: ${nextBase}`);
			}

			return {
				nextBase,
				result: { issue: issueNumber, reused: true, status: "ok" },
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
			...(emit !== undefined ? { emit } : {}),
			ignoreSetup,
			resume,
			setupOutput,
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
 * Runs issues serially, chaining each completed branch as the next base.
 *
 * @remarks
 *   With `nextOrder` the batch runs **live**: the order is re-read after every dispatched member
 *   and the walk resumes from the last processed one, so a follow-up a review registers mid-run
 *   dispatches next with the reviewed member's branch as its base. Without it the explicit list is
 *   the intent, and the frozen order runs as-is.
 * @param issueNumbers - Members to run, in order; with {@link SequentialIssueOptions.nextOrder}
 *   this is the fire-time order, and the live walk may run members that joined the batch since.
 * @returns Every member processed, in order — reused members included, each marked `reused`.
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
): Promise<Array<SequentialIssueResult>> {
	if (issueNumbers.length === 0) {
		throw new Error("At least one issue number is required for sequential workflow");
	}

	/*
	 * Deliberately not in the signature: the empty-input guard above has to run before the defaults
	 * are applied, so the options are unwrapped here rather than in the parameter list.
	 */
	// oxlint-disable-next-line flawless/prefer-parameter-destructuring -- guarded before defaults apply
	const {
		budget,
		dispatchIssue = processSequentialIssue,
		emit,
		ignoreSetup,
		nextOrder,
		pushAndDelete = false,
		setupOutput,
		skipSetup,
		steps,
		strictChain,
		worktree,
	} = options;
	console.log(`\n${"=".repeat(80)}`);
	console.log("Sequential Issue Workflow");
	console.log("=".repeat(80));
	console.log(
		`Issues: ${issueNumbers.join(" → ")}${
			nextOrder === undefined ? "" : " (live: the order is re-read before each member)"
		}`,
	);
	console.log(`Base: ${baseRef}`);
	console.log(`${"=".repeat(80)}\n`);

	const results: Array<SequentialIssueResult> = [];
	let currentBase = baseRef;

	if (nextOrder === undefined) {
		for (let index = 0; index < issueNumbers.length; index++) {
			const issueNumber = issueNumbers[index];
			if (issueNumber === undefined) {
				continue;
			}

			const processed = await dispatchIssue({
				agentBackend,
				currentBase,
				effort,
				...(emit !== undefined ? { emit } : {}),
				ignoreSetup,
				index,
				isLast: index === issueNumbers.length - 1,
				issueNumber,
				model,
				pushAndDelete,
				resume,
				setupOutput,
				skipSetup,
				...(steps ? { steps } : {}),
				...(strictChain !== undefined ? { strictChain } : {}),
				total: issueNumbers.length,
				worktree,
			});
			results.push(processed.result);
			currentBase = processed.nextBase;
			if (processed.stop) {
				break;
			}
		}
	} else {
		/*
		 * Live dispatch. The cursor is the last processed member; each pass re-reads the order,
		 * reuse-chains every completed member it meets, and dispatches the first pending one — then
		 * re-reads again, because that member's review may have registered a follow-up into this
		 * batch. Reused members run no agent, so they cannot change the manifest and the walk
		 * continues through them in one pass.
		 */
		let cursor: string | undefined;
		let done = false;
		let newDispatches = 0;
		while (!done) {
			const order = nextOrder();
			if (order === undefined || (cursor !== undefined && !order.includes(cursor))) {
				console.warn(
					`   ⚠ Batch order no longer contains #${cursor ?? "any member"}; stopping the workflow.`,
				);
				break;
			}

			const start = cursor === undefined ? 0 : order.indexOf(cursor) + 1;
			let dispatchedNew = false;
			for (let index = start; index < order.length; index++) {
				const issueNumber = order[index];
				if (issueNumber === undefined) {
					continue;
				}

				const processed = await dispatchIssue({
					agentBackend,
					currentBase,
					effort,
					...(emit !== undefined ? { emit } : {}),
					ignoreSetup,
					index,
					isLast: false,
					issueNumber,
					model,
					pushAndDelete,
					resume,
					setupOutput,
					skipSetup,
					...(steps ? { steps } : {}),
					...(strictChain !== undefined ? { strictChain } : {}),
					total: order.length,
					worktree,
				});
				results.push(processed.result);
				currentBase = processed.nextBase;
				cursor = issueNumber;
				if (processed.stop) {
					done = true;
					break;
				}

				if (processed.result.reused === true) {
					continue;
				}

				newDispatches += 1;
				if (budget !== undefined && newDispatches >= budget) {
					console.log(
						`   ⏹ --max-issues budget (${String(budget)}) spent; the batch may have grown ` +
							"mid-run. Re-run to continue it.",
					);
					done = true;
					break;
				}

				/*
				 * A dispatched member's review may have registered a follow-up into this batch:
				 * re-read the order before choosing the next member, so the follow-up dispatches
				 * next, chained from this member's branch.
				 */
				dispatchedNew = true;
				break;
			}

			if (!dispatchedNew) {
				done = true;
			}
		}
	}

	const summary = printSequentialWorkflowSummary(results);
	if (summary.blocked > 0 || summary.failed > 0) {
		io.exit(1);
	}

	return results;
}

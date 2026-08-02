/*
 * Sequential issue workflow: runs a list of issues serially, chaining each
 * completed branch as the next base, and aborts if any review ends "blocked".
 */

import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { checkoutBranch, gitTry } from "./git.js";
import { runSingleIssue } from "./issue.js";
import { config, io, repoRoot } from "./runtime.js";
import { getLatestReviewMarker, isIssueBlocked, isIssueComplete } from "./state.js";
import type { AgentBackend } from "./types.js";

interface SequentialIssueResult {
	error?: string;
	issue: string;
	status: "ok" | "failed" | "blocked";
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

async function processSequentialIssue({
	agentBackend,
	currentBase,
	effort,
	ignoreSetup,
	index,
	isLast,
	issueNumber,
	maxImplementIterations,
	model,
	resume,
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
	maxImplementIterations: number;
	model: string;
	resume: boolean;
	total: number;
	worktree?: string;
}): Promise<{ nextBase: string; result: SequentialIssueResult; stop: boolean }> {
	console.log(`\n[${index + 1}/${total}] Processing issue #${issueNumber}...`);

	const branchName =
		worktree !== undefined && worktree !== ""
			? (checkoutBranch(worktree) ?? `sandcastle/issue-${issueNumber}`)
			: `sandcastle/issue-${issueNumber}`;
	const worktreePath =
		worktree ??
		pathResolve(repoRoot, config.dir, "worktrees", `sandcastle-issue-${issueNumber}`);

	if (
		resume &&
		(worktree === undefined || worktree === "") &&
		isIssueComplete(issueNumber) &&
		getLatestReviewMarker(issueNumber) === "APPROVED" &&
		existsSync(worktreePath) &&
		gitTry(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`]) !== undefined
	) {
		console.log(`   ⏭ Issue #${issueNumber} already completed; reusing ${branchName}.`);
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

	if (currentBase.startsWith("sandcastle/")) {
		console.log(`   Using accumulated base: ${currentBase}`);
	} else {
		console.log(`   Base ref: ${currentBase}`);
	}

	try {
		await runSingleIssue(issueNumber, model, effort, maxImplementIterations, {
			agentBackend,
			baseRef: currentBase,
			ignoreSetup,
			resume,
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
	maxImplementIterations: number,
	agentBackend: AgentBackend,
	resume: boolean,
	worktree?: string,
	ignoreSetup = false,
): Promise<void> {
	if (issueNumbers.length === 0) {
		throw new Error("At least one issue number is required for sequential workflow");
	}

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
			maxImplementIterations,
			model,
			resume,
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

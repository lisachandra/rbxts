/*
 * Single-issue orchestration: the three phases (Design → Implement → Review)
 * share one persistent worktree, and "all" mode plans the open issue queue and
 * dispatches it with bounded concurrency.
 */

import { Output, type SandboxRunOptions, type SandboxRunResult } from "@ai-hero/sandcastle";

import { mkdirSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { z } from "zod";

import { createAgent, fetchIssueLabels, issueView, skillsForPrompt } from "./agent.js";
import { createFreshPhaseEvaluation, evaluatePhases } from "./evaluate.js";
import { countNewCommits, resolveCommit } from "./git.js";
import {
	clearMarker,
	markerExists,
	markerPath,
	markerPromptArgs,
	runMarkerPhase,
} from "./markers.js";
import { runPhaseWithRetry } from "./retry.js";
import { config, io, logsDir, plansDir, stateDir } from "./runtime.js";
import { readState, updatePhase, writeState } from "./state.js";
import type {
	AgentBackend,
	EvaluationResult,
	PhaseDecision,
	PhaseName,
	PhaseState,
	SharedPromptArgs,
} from "./types.js";
import {
	createIssueSandbox,
	prepareIssueWorktree,
	sandboxProvider,
	validateExistingWorktree,
} from "./worktree.js";

// Zod schema for the planner's <plan> output.
const PlanSchema = z.object({
	issues: z.array(
		z.object({
			branch: z.string().describe("Worktree branch name"),
			id: z.string().describe("GitHub issue number"),
			title: z.string().describe("Issue title"),
		}),
	),
});

function printPhaseEvaluation(eval_: EvaluationResult): void {
	console.log("\n── Phase evaluation ──");
	for (const phase of ["design", "implement", "review"] as Array<PhaseName>) {
		const decision = eval_[phase];
		const icon = decision === "skip" ? "⏭" : decision === "force" ? "🔄" : "▶";
		console.log(`  ${icon} ${phase}: ${decision.toUpperCase()} — ${eval_.reasons[phase]}`);
	}

	console.log("  ℹ Decisions are re-checked against on-disk state before each phase runs.");
}

function loadIssueContext(issueNumber: string): {
	issueLabels: Array<string>;
	issueTitle: string;
} {
	let issueTitle = "";
	try {
		issueTitle = io
			.execSync(`${issueView(issueNumber)} --json title --jq .title`, {
				encoding: "utf-8",
			})
			.toString()
			.trim();
	} catch {
		console.warn(`  ⚠ Could not fetch issue title for #${issueNumber}`);
	}

	const issueLabels = fetchIssueLabels(issueNumber).map((label) => label.toLowerCase());
	console.log(`  Labels: ${issueLabels.length > 0 ? issueLabels.join(", ") : "none"}`);
	return { issueLabels, issueTitle };
}

async function runDesignPhase(params: {
	agentBackend: AgentBackend;
	effort: string;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	model: string;
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
	};
	sharedArgs: SharedPromptArgs;
	state: PhaseState;
}): Promise<void> {
	console.log(`\n── Phase 1: Design (issue #${params.issueNumber}) ──`);
	const marker = markerPath(`${params.issueNumber}.design`);

	await runPhaseWithRetry(
		() =>
			runMarkerPhase({
				agentBackend: params.agentBackend,
				effort: params.effort,
				marker,
				model: params.model,
				name: `designer #${params.issueNumber}`,
				promptArgs: {
					...params.sharedArgs,
					SKILLS: skillsForPrompt("design", params.issueLabels),
				},
				promptFile: config.prompts.plan,
				run: params.sandbox.run,
				runOptions: { logging: { type: "file", path: params.logPath, verbose: true } },
			}),
		"design",
	);

	updatePhase(params.state, "design", "done");
	console.log("  ✓ Design phase complete.");
}

async function runImplementPhase(params: {
	agentBackend: AgentBackend;
	effort: string;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	model: string;
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
	};
	sharedArgs: SharedPromptArgs;
	state: PhaseState;
}): Promise<void> {
	console.log(`\n── Phase 2: Implement (issue #${params.issueNumber}) ──`);
	const marker = markerPath(`${params.issueNumber}.implement`);

	const implResult = await runPhaseWithRetry(
		() =>
			runMarkerPhase({
				agentBackend: params.agentBackend,
				effort: params.effort,
				marker,
				model: params.model,
				name: `implementer #${params.issueNumber}`,
				promptArgs: {
					...params.sharedArgs,
					SKILLS: skillsForPrompt("implement", params.issueLabels),
				},
				promptFile: config.prompts.implement,
				run: params.sandbox.run,
				runOptions: { logging: { type: "file", path: params.logPath, verbose: true } },
			}),
		"implement",
	);

	updatePhase(params.state, "implement", "done", {
		buildPassed: true,
		commits: implResult.commits.map((c) => c.sha),
	});
	console.log(`  ✓ Implement phase complete. Commits: ${implResult.commits.length}`);
}

async function runReviewPhase(params: {
	agentBackend: AgentBackend;
	effort: string;
	evalReview: PhaseDecision;
	hasCommits: boolean;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	model: string;
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
	};
	sharedArgs: SharedPromptArgs;
	state: PhaseState;
}): Promise<void> {
	if (params.hasCommits || params.evalReview === "force") {
		console.log(`\n── Phase 3: Review (issue #${params.issueNumber}) ──`);
		const marker = markerPath(`${params.issueNumber}.review`);

		await runPhaseWithRetry(
			() =>
				runMarkerPhase({
					agentBackend: params.agentBackend,
					effort: params.effort,
					marker,
					model: params.model,
					name: `reviewer #${params.issueNumber}`,
					promptArgs: {
						...params.sharedArgs,
						SKILLS: skillsForPrompt("review", params.issueLabels),
					},
					promptFile: config.prompts.review,
					run: params.sandbox.run,
					runOptions: { logging: { type: "file", path: params.logPath, verbose: true } },
				}),
			"review",
		);

		updatePhase(params.state, "review", "done", { commentPosted: true });
		console.log("  ✓ Review phase complete.");
		return;
	}

	console.log("\n  ⏭ Skipping review — no commits produced.");
	updatePhase(params.state, "review", "skipped");
}

function createOrLoadIssueState(params: {
	branchName: string;
	effort: string;
	issueNumber: string;
	model: string;
	options?: {
		baseRef?: string;
	};
}): PhaseState {
	return (
		readState(params.issueNumber) ?? {
			base:
				params.options?.baseRef !== undefined && params.options.baseRef !== ""
					? { commit: resolveCommit(params.options.baseRef), ref: params.options.baseRef }
					: undefined,
			branch: params.branchName,
			effort: params.effort,
			issue: params.issueNumber,
			model: params.model,
			phases: {
				design: { status: "skipped", timestamp: "" },
				implement: { status: "skipped", timestamp: "" },
				review: { status: "skipped", timestamp: "" },
			},
		}
	);
}

function syncIssueStateOnResume(params: {
	effort: string;
	model: string;
	options?: { baseRef?: string };
	resume: boolean;
	state: PhaseState;
}): void {
	if (
		!params.resume &&
		(params.options?.baseRef === undefined || params.options.baseRef === "")
	) {
		return;
	}

	params.state.model = params.model;
	params.state.effort = params.effort;
	if (params.options?.baseRef !== undefined && params.options.baseRef !== "") {
		params.state.base = {
			commit: resolveCommit(params.options.baseRef),
			ref: params.options.baseRef,
		};
	}

	writeState(params.state);
}

interface ExecuteIssuePhasesParams {
	agentBackend: AgentBackend;
	attempted: Set<PhaseName>;
	effort: string;
	eval_: EvaluationResult;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	model: string;
	options?: { baseRef?: string; force?: true | PhaseName; phase?: PhaseName };
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
		worktreePath: string;
	};
	sharedArgs: SharedPromptArgs;
	state: PhaseState;
}

/**
 * Re-evaluates a single phase against current on-disk state. Later phases depend on artifacts
 * produced by earlier ones (plan → commits), so a pre-flight evaluation made before design runs is
 * not a valid decision for implement/review once design finishes.
 */
function reEvaluatePhase(params: ExecuteIssuePhasesParams, phase: PhaseName): PhaseDecision {
	return evaluatePhases(params.issueNumber, params.state.model, {
		baseRef: params.options?.baseRef,
		force: params.options?.force,
		phase: params.options?.phase,
		resume: true,
		worktree: params.sandbox.worktreePath,
	})[phase];
}

async function executeIssuePhases(params: ExecuteIssuePhasesParams): Promise<void> {
	if (params.eval_.design !== "skip") {
		params.attempted.add("design");
		await runDesignPhase({
			agentBackend: params.agentBackend,
			effort: params.effort,
			issueLabels: params.issueLabels,
			issueNumber: params.issueNumber,
			logPath: params.logPath,
			model: params.model,
			sandbox: params.sandbox,
			sharedArgs: params.sharedArgs,
			state: params.state,
		});
	} else {
		console.log("\n── Phase 1: Design — SKIPPED ──");
	}

	// Re-evaluate implement after design: a resumed run may have just produced the plan.
	if (reEvaluatePhase(params, "implement") !== "skip") {
		params.attempted.add("implement");
		await runImplementPhase({
			agentBackend: params.agentBackend,
			effort: params.effort,
			issueLabels: params.issueLabels,
			issueNumber: params.issueNumber,
			logPath: params.logPath,
			model: params.model,
			sandbox: params.sandbox,
			sharedArgs: params.sharedArgs,
			state: params.state,
		});
	} else {
		console.log("\n── Phase 2: Implement — SKIPPED ──");
	}

	const hasCommits =
		countNewCommits(
			params.sandbox.worktreePath,
			params.state.base?.ref ?? params.options?.baseRef ?? config.baseBranch,
		) > 0;

	// Re-evaluate review after implement: a resumed run may have just produced commits.
	const reviewDecision = reEvaluatePhase(params, "review");
	if (reviewDecision !== "skip") {
		params.attempted.add("review");
		await runReviewPhase({
			agentBackend: params.agentBackend,
			effort: params.effort,
			evalReview: reviewDecision,
			hasCommits,
			issueLabels: params.issueLabels,
			issueNumber: params.issueNumber,
			logPath: params.logPath,
			model: params.model,
			sandbox: params.sandbox,
			sharedArgs: params.sharedArgs,
			state: params.state,
		});
	} else {
		console.log("\n── Phase 3: Review — SKIPPED ──");
	}

	if (
		!params.options?.phase &&
		(params.state.phases.implement.status !== "done" ||
			params.state.phases.review.status !== "done")
	) {
		throw new Error(
			"Issue workflow incomplete: implementation and review must both complete before handoff.",
		);
	}
}

function resolveActiveFailedPhase(
	eval_: EvaluationResult,
	state: PhaseState,
	attempted: ReadonlySet<PhaseName>,
): PhaseName {
	/*
	 * Prefer the phases actually attempted this invocation: the first one that did not
	 * finish is the one that failed. This avoids blaming review when implement was the
	 * phase that ran and failed on a resumed run.
	 */
	for (const phase of ["design", "implement", "review"] as const) {
		if (attempted.has(phase) && state.phases[phase].status !== "done") {
			return phase;
		}
	}

	/*
	 * Fallback when nothing was attempted (e.g. setup failed before any phase ran):
	 * keep --phase isolation semantics by respecting which phases were in scope.
	 */
	if (eval_.design !== "skip" && state.phases.design.status !== "done") {
		return "design";
	}

	if (eval_.implement !== "skip" && state.phases.implement.status !== "done") {
		return "implement";
	}

	return "review";
}

export async function runSingleIssue(
	issueNumber: string,
	model: string,
	effort: string,
	options?: {
		agentBackend?: AgentBackend;
		baseRef?: string;
		force?: true | PhaseName;
		ignoreSetup?: boolean;
		phase?: PhaseName;
		resume?: boolean;
		worktree?: string;
	},
): Promise<void> {
	const suppliedWorktree =
		options?.worktree !== undefined && options.worktree !== ""
			? validateExistingWorktree(options.worktree)
			: undefined;
	const branchName = suppliedWorktree?.branch ?? `sandcastle/issue-${issueNumber}`;
	const planPath = `${config.dir}/plans/${issueNumber}.md`;
	const logPath = pathResolve(logsDir, `issue-${issueNumber}.log`);

	mkdirSync(logsDir, { recursive: true });
	mkdirSync(plansDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });

	const resume = options?.resume ?? false;
	const eval_ =
		resume || options?.phase
			? evaluatePhases(issueNumber, model, {
					baseRef: options?.baseRef,
					force: options?.force,
					phase: options?.phase,
					resume,
					worktree: options?.worktree,
				})
			: createFreshPhaseEvaluation();

	if (resume || options?.phase) {
		printPhaseEvaluation(eval_);
	}

	const { issueLabels, issueTitle } = loadIssueContext(issueNumber);
	const sharedArgs = {
		BASE_REF: options?.baseRef ?? config.baseBranch,
		BRANCH: branchName,
		ISSUE_NUMBER: issueNumber,
		ISSUE_TITLE: issueTitle,
		PLAN_PATH: planPath,
		SKILLS: skillsForPrompt("design", issueLabels),
	};

	const state = createOrLoadIssueState({
		branchName,
		effort,
		issueNumber,
		model,
		options,
	});
	syncIssueStateOnResume({ effort, model, options, resume, state });

	const sandbox = await createIssueSandbox(branchName, suppliedWorktree, options?.baseRef);
	const attempted = new Set<PhaseName>();
	try {
		if (eval_.design !== "skip" || eval_.implement !== "skip" || eval_.review !== "skip") {
			prepareIssueWorktree(sandbox.worktreePath, options?.ignoreSetup);
		}

		await executeIssuePhases({
			agentBackend: options?.agentBackend ?? "dirac",
			attempted,
			effort,
			eval_,
			issueLabels,
			issueNumber,
			logPath,
			model,
			options,
			sandbox,
			sharedArgs,
			state,
		});
	} catch (err) {
		const activePhase = resolveActiveFailedPhase(eval_, state, attempted);
		updatePhase(state, activePhase, "failed", { error: String(err) });
		state.lastError = String(err);
		writeState(state);

		console.error(`  ✗ ${activePhase} phase failed.`);
		console.error(`  ✗ Worktree preserved at: ${sandbox.worktreePath}`);
		const worktreeFlag =
			options?.worktree !== undefined && options.worktree !== ""
				? ` --worktree ${options.worktree}`
				: "";
		console.error(
			`  ✗ Resume with: pnpm sandcastle:issue -- --issue ${issueNumber} --resume${worktreeFlag}`,
		);
		throw err;
	} finally {
		await sandbox.close();
	}
}

export async function runAll(
	model: string,
	agentBackend: AgentBackend,
	effort: string,
	concurrency: number,
	ignoreSetup = false,
): Promise<void> {
	console.log("Planning: analysing open issues for dependencies...\n");
	const marker = markerPath("planner");
	clearMarker(marker);

	const planResult = await io.run({
		agent: createAgent(agentBackend, model, effort, marker),
		maxIterations: 1,
		name: "planner",
		output: Output.object({ schema: PlanSchema, tag: "plan" }),
		promptArgs: {
			BASE_REF: config.baseBranch,
			BRANCH: "",
			ISSUE_NUMBER: "all",
			ISSUE_TITLE: "",
			...markerPromptArgs(marker),
			PLAN_PATH: "",
			READY_LABEL: config.labels.readyForAgent,
			SKILLS: skillsForPrompt("design"),
		},
		promptFile: config.prompts.planAll,
		sandbox: sandboxProvider,
	});

	if (!markerExists(marker)) {
		throw new Error("Planner finished without a completion marker.");
	}

	const { issues } = planResult.output;

	if (issues.length === 0) {
		console.log("No unblocked issues to work on.");
		return;
	}

	console.log(`Found ${issues.length} unblocked issue(s):`);
	for (const issue of issues) {
		console.log(`  #${issue.id}: ${issue.title} → ${issue.branch}`);
	}

	// Run issues with bounded concurrency.
	console.log(`\nDispatching ${issues.length} issue(s) with concurrency ${concurrency}...\n`);

	interface IssueResult {
		error?: string;
		id: string;
		status: "ok" | "failed";
	}

	const results: Array<IssueResult> = [];

	// Concurrency pool: process issues from the queue, at most `concurrency` at a time.
	const queue = [...issues];
	const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () =>
		(async () => {
			for (;;) {
				const issue = queue.shift();
				if (issue === undefined || issue === "") {
					break;
				}

				console.log(`[#${issue.id}] Starting...`);
				try {
					await runSingleIssue(issue.id, model, effort, {
						agentBackend,
						ignoreSetup,
					});
					console.log(`[#${issue.id}] ✓ Complete`);
					results.push({ id: issue.id, status: "ok" });
				} catch (err) {
					console.error(`[#${issue.id}] ✗ Failed: ${err}`);
					results.push({ error: String(err), id: issue.id, status: "failed" });
				}
			}
		})(),
	);

	await Promise.all(workers);

	// Summary
	const ok = results.filter((r) => r.status === "ok");
	const failed = results.filter((r) => r.status === "failed");
	console.log(`\n── Run complete: ${ok.length} ok, ${failed.length} failed ──`);
	for (const r of failed) {
		console.error(`  ✗ #${r.id}: ${r.error}`);
	}
}

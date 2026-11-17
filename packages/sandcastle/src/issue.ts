/*
 * Single-issue orchestration: the three phases (Design → Implement → Review)
 * share one persistent worktree, and "all" mode plans the open issue queue and
 * dispatches it with bounded concurrency.
 */

import {
	type AgentStreamEvent,
	type LoggingOption,
	Output,
	type SandboxRunOptions,
	type SandboxRunResult,
} from "@ai-hero/sandcastle";

import { existsSync, mkdirSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { z } from "zod";

import { createAgent } from "./agent.js";
import type { SetupOutput } from "./config.js";
import { phaseNames } from "./config.js";
import {
	createFreshPhaseEvaluation,
	evaluatePhases,
	resolvePlanFile,
	worktreePlanPath,
} from "./evaluate.js";
import {
	countNewCommits,
	countStaleCommits,
	git,
	gitTry,
	issueBranch,
	resolveCommit,
} from "./git.js";
import { issueMetadata } from "./issue-metadata.js";
import { clearMarker, markerExists, markerPath } from "./markers.js";
import { runPhase } from "./phase.js";
import { completionPromptArgs } from "./prompts/completion.js";
import { queueRulesForPrompt } from "./prompts/queue.js";
import { setupNoteFor } from "./prompts/setup-note.js";
import { skillsForPrompt } from "./prompts/skills.js";
import { saveSession } from "./providers/session-store.js";
import { locateIssue, readQueueManifest } from "./queue/manifest.js";
import { ConfigReloader, launchSelection, watchStep } from "./reload.js";
import { runPhaseWithRetry } from "./retry.js";
import { config, io, logsDir, plansDir, stateDir, worktreePathForBranch } from "./runtime.js";
import { runSessioned } from "./session-resume.js";
import {
	assertCommitSigned,
	readCommitSigningPolicy,
	signingArgs,
	UnsignedCommitError,
} from "./signing.js";
import {
	isReviewComplete,
	readState,
	recordedCommits,
	unionCommits,
	updatePhase,
	writeState,
} from "./state.js";
import type {
	AgentBackend,
	AgentPhaseName,
	AgentStepsConfig,
	EvaluationResult,
	PhaseDecision,
	PhaseName,
	PhaseState,
	ResolvedAgentStep,
	SandcastleEffort,
	SharedPromptArgs,
} from "./types.js";
import { backendSupportsResume, resumableBackends } from "./types.js";
import {
	createIssueSandbox,
	type EmitLine,
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
	const meta = issueMetadata(issueNumber);
	if (meta.title === "(could not fetch)") {
		console.warn(`  ⚠ Could not fetch issue title for #${issueNumber}`);
	}

	const issueLabels = meta.labels.map((label) => label.toLowerCase());
	console.log(`  Labels: ${issueLabels.length > 0 ? issueLabels.join(", ") : "none"}`);
	return { issueLabels, issueTitle: meta.title };
}

/**
 * - Batch name an issue currently belongs to, when it is a member of one.
 * - @param issueNumber - Issue number.
 * - @returns The batch name, or `undefined` when the issue is gated, human, or unplaced.
 * - @remarks The review prompt names this batch so a follow-up that continues the work joins it
 *   instead of being parked behind a gate. A repository without a manifest, or an issue whose
 *   placement cannot be read, reports `undefined` and the prompt stays batch-agnostic.
 */
function queueBatchForIssue(issueNumber: string): string | undefined {
	try {
		const placement = locateIssue(readQueueManifest(), issueNumber);
		return placement?.kind === "sequence" ? placement.name : undefined;
	} catch {
		return undefined;
	}
}

/** What one issue phase needs from the driver, shared by all three. */
interface IssuePhaseContext {
	/** `--base-ref`, when the caller supplied one; review falls back to it for its commit count. */
	baseRef?: string;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	/** Live config follower; each attempt re-reads its step so a reload takes effect on restart. */
	reloader: ConfigReloader;
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
		worktreePath: string;
	};
	/** Shared session scope and prompt note; split mode leaves both defaulted. */
	session: PhaseSession;
	sharedArgs: SharedPromptArgs;
	state: PhaseState;
}

/**
 * One issue phase, as data.
 *
 * - `promptFile` is read at run time rather than captured: a config reload can point it somewhere
 *   else, and the retry that follows the abort must use the new value.
 * - `record` owns both the state write and the completion line, so "the phase finished" is one
 *   decision in one place instead of a `updatePhase` plus a `console.log` that can drift apart.
 */
interface IssuePhaseDef {
	/** Runs after the phase when it ran, and on the skip path where today's driver did. */
	after?(context: IssuePhaseContext): void;
	/** Extra prompt args beyond the shared ones — the review phase's queue rules. */
	extraPromptArgs?(context: IssuePhaseContext): Record<string, string>;
	label: string;
	name: PhaseName;
	/** 1-based position, for the "Phase N: X" heading. */
	position: number;
	promptFile(): string;
	record(context: IssuePhaseContext, result: SandboxRunResult): void;
	/** Agent role in the display name, e.g. `designer #425`. */
	role: string;
	/**
	 * A precondition the phase itself owns, beyond its evaluation decision.
	 *
	 * Review is the only user: it has nothing to look at when implement produced no commits, and
	 * that is review's business rather than the loop's.
	 */
	shouldRun?(
		context: IssuePhaseContext,
		decision: PhaseDecision,
	): { run: true } | { record(): void; run: false };
}

/** The three phases, in the order they run. The loop walks this; nothing else knows the order. */
const issuePhaseDefs: ReadonlyArray<IssuePhaseDef> = [
	{
		after: (context) => {
			/*
			 * The design marker and the design plan are separate artifacts, and the marker is the only
			 * one the runner verifies. A plan written anywhere but the worktree path therefore counted
			 * as a finished design: implement was skipped for a missing plan, review had no commits to
			 * read, and the run failed blaming review. Refuse the hand-off here instead, naming the
			 * one path the implementer will open.
			 */
			const repoPlanPath = pathResolve(plansDir, `${context.issueNumber}.md`);
			if (
				context.state.phases.design.status === "done" &&
				resolvePlanFile(repoPlanPath, context.sandbox.worktreePath) === undefined
			) {
				throw new Error(
					`Design completed but no plan was found at ${worktreePlanPath(
						context.sandbox.worktreePath,
						context.issueNumber,
					)} or ${repoPlanPath}. Write the plan to the worktree path, then resume.`,
				);
			}
		},
		label: "Design",
		name: "design",
		position: 1,
		promptFile: () => config.prompts.plan,
		record: (context) => {
			recordPhaseConfig(context.state, context.reloader);
			updatePhase(context.state, "design", "done");
			commitPlan(context.sandbox.worktreePath, context.issueNumber);
			console.log("  ✓ Design phase complete.");
		},
		role: "designer",
	},
	{
		label: "Implement",
		name: "implement",
		position: 2,
		promptFile: () => config.prompts.implement,
		record: (context, result) => {
			/*
			 * Combined, not replaced: the sandbox reports only the commits made during this run, so a
			 * re-run that finds the work already on the branch would otherwise blank the record of the
			 * run that did it and leave the issue looking unfinished.
			 */
			const commits = unionCommits(
				recordedCommits(context.state),
				result.commits.map((commit) => commit.sha),
			);
			updatePhase(context.state, "implement", "done", { buildPassed: true, commits });
			console.log(
				result.commits.length === 0 && commits.length > 0
					? `  ✓ Implement phase complete. No new commits; ${String(commits.length)} already on the branch.`
					: `  ✓ Implement phase complete. Commits: ${String(commits.length)}`,
			);
		},
		role: "implementer",
	},
	{
		extraPromptArgs: (context) => ({
			QUEUE_RULES: queueRulesForPrompt({ batch: queueBatchForIssue(context.issueNumber) }),
		}),
		label: "Review",
		name: "review",
		position: 3,
		promptFile: () => config.prompts.review,
		record: (context) => {
			recordPhaseConfig(context.state, context.reloader);
			updatePhase(context.state, "review", "done", { commentPosted: true });
			console.log("  ✓ Review phase complete.");
		},
		role: "reviewer",
		shouldRun: (context, decision) => {
			const hasCommits =
				countNewCommits(
					context.sandbox.worktreePath,
					context.state.base?.ref ?? context.baseRef ?? config.baseBranch,
				) > 0;
			return hasCommits || decision === "force"
				? { run: true }
				: {
						record: () => {
							console.log("\n  ⏭ Skipping review — no commits produced.");
							/*
							 * `noCommits` is what makes the skip terminal: review had nothing to look at, so
							 * the issue is finished rather than unfinished. Recording the reason is
							 * load-bearing — `skipped` on its own is also the fresh-state value, and
							 * treating that as reviewed would let a run that died between implement and
							 * review pass as complete.
							 */
							updatePhase(context.state, "review", "skipped", { noCommits: true });
						},
						run: false,
					};
		},
	},
];

/**
 * - Runs one issue phase through {@link runPhase}.
 * - @param def - Which phase, and what it does after the attempt.
 * - @param context - The driver's state and collaborators.
 * - @returns The sandbox run result.
 * - @remarks The attempt is rebuilt per attempt rather than captured, so the selection and the config
 *   watcher are read after a reload rather than before it — the property `reloader` exists to
 *   provide.
 */
async function runIssuePhase(
	def: IssuePhaseDef,
	context: IssuePhaseContext,
): Promise<SandboxRunResult> {
	console.log(`
── Phase ${String(def.position)}: ${def.label} (issue #${context.issueNumber}) ──`);
	const result = await runPhase(def.name, () => {
		const selection = context.reloader.step(def.name);
		return {
			logPath: context.logPath,
			marker: markerPath(`${context.issueNumber}.${def.name}`),
			name: `${def.role} #${context.issueNumber}`,
			promptArgs: {
				...context.sharedArgs,
				...def.extraPromptArgs?.(context),
				SESSION_NOTE: context.session.notes[def.name],
				SKILLS: skillsForPrompt(def.name, context.issueLabels),
			},
			promptFile: def.promptFile(),
			run: context.sandbox.run,
			scope: context.session.scope ?? `${context.issueNumber}.${def.name}`,
			selection,
			...(context.session.scope === undefined ? {} : { sessionScope: context.session.scope }),
			watchConfig: watchStep(context.reloader, def.name),
		};
	});
	def.record(context, result);
	return result;
}

/**
 * - Stamps the selection each phase is running on onto the issue state.
 * - @param state - The issue's phase state, written by the caller's `updatePhase`.
 * - @param reloader - The live follower the selection came from.
 * - @remarks Recorded per attempt rather than once per run: the point of the stamp is that a later
 *   `status` or audit can tell which model produced which phase, and a run that switched models
 *   halfway has two answers. `evaluate` no longer re-runs a phase because this value moved.
 */
function recordPhaseConfig(state: PhaseState, reloader: ConfigReloader): void {
	state.phasesConfig = {
		design: reloader.step("design"),
		implement: reloader.step("implement"),
		review: reloader.step("review"),
	};
	state.model = reloader.step("implement").model;
	state.effort = reloader.step("implement").effort;
}

/**
 * - Commits the design plan on the issue branch so it travels with the work.
 * - @param worktreePath - The issue's worktree, where the agent wrote the plan.
 * - @param issueNumber - Issue number; names the plan file.
 * - @remarks Best-effort, like the queue manifest commit: the plan is the record of what the issue
 *   was designed to do, so a later batch member chaining this branch can read it, and a reset that
 *   drops the worktree does not take the plan with it. A distinct unprefixed path is staged
 *   explicitly so an agent's unrelated dirty edits are never swept into this commit.
 *
 *   An unsigned commit under a host that requires signatures is the one failure that is **not**
 *   best-effort. It rethrows: the commit exists and is missing what the host policy demands, and a
 *   warning here leaves exactly the history that cost a rewrite, to be discovered when someone
 *   finally notices it on `main`. Signing is asked for on the argv and then verified, because a flag
 *   asks git to sign and only `%G?` says whether it did.
 *
 * @internal
 */
export function commitPlan(worktreePath: string, issueNumber: string): void {
	const relative = `${config.dir}/plans/${issueNumber}.md`;
	if (!existsSync(pathResolve(worktreePath, relative))) {
		return;
	}

	const subject = `docs(sandcastle): add plan for #${issueNumber}`;
	try {
		/*
		 * --porcelain prints nothing for an *ignored* untracked path, which is indistinguishable
		 * from "already committed", so a base whose .gitignore still said `.sandcastle/**` with no
		 * `!.sandcastle/plans/**` negation made every plan commit a silent no-op and nothing carried
		 * the plan to the next batch member.
		 *
		 * The plan is the issue's own artifact and the runner owns this path, so an ignoring
		 * `.gitignore` on the base is not a reason to drop it: `-f` stages it anyway. Reporting the
		 * skip instead left the batch member without a plan, which is the state #391 and the whole
		 * ui-wiring-work chain were in — a branch whose plan exists only inside a worktree that the
		 * next `queue clean` deletes.
		 */
		const ignored =
			gitTry(["check-ignore", "--quiet", "--", relative], worktreePath) !== undefined;
		if (
			!ignored &&
			(gitTry(["status", "--porcelain", "--", relative], worktreePath) ?? "") === ""
		) {
			return;
		}

		const policy = readCommitSigningPolicy(worktreePath);
		git(["add", "-f", "--", relative], worktreePath);
		git(["commit", ...signingArgs(policy), "-m", subject, "--", relative], worktreePath);
		assertCommitSigned(subject, policy, worktreePath);
		console.log(`  ✓ Committed the plan to ${issueBranch(issueNumber)}.`);
		if (ignored) {
			console.warn(
				`  ! ${relative} is gitignored on this branch; committed it anyway. Negate it in .gitignore so a plain \`git add\` sees it too.`,
			);
		}
	} catch (err) {
		if (err instanceof UnsignedCommitError) {
			throw err;
		}

		console.warn(
			`  ⚠ Could not commit the plan for #${issueNumber}: ${String(err)}\n` +
				`    Commit it yourself (\`git -C ${worktreePath} add -f -- ${relative} && git -C ${worktreePath} commit -m "${subject}"\`).`,
		);
	}
}

function createOrLoadIssueState(params: {
	branchName: string;
	effort: string;
	issueNumber: string;
	model: string;
	options?: {
		baseRef?: string;
	};
	phasesConfig?: PhaseState["phasesConfig"];
	steps?: Record<AgentPhaseName, ResolvedAgentStep>;
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
			phasesConfig: params.steps
				? {
						design: params.steps.design,
						implement: params.steps.implement,
						review: params.steps.review,
					}
				: params.phasesConfig,
		}
	);
}

function syncIssueStateOnResume(params: {
	effort: string;
	model: string;
	options?: { baseRef?: string };
	resume: boolean;
	state: PhaseState;
	steps?: Record<AgentPhaseName, ResolvedAgentStep>;
}): void {
	if (
		!params.resume &&
		(params.options?.baseRef === undefined || params.options.baseRef === "")
	) {
		return;
	}

	params.state.model = params.model;
	params.state.effort = params.effort;
	if (params.steps) {
		params.state.phasesConfig = {
			design: params.steps.design,
			implement: params.steps.implement,
			review: params.steps.review,
		};
	}

	if (params.options?.baseRef !== undefined && params.options.baseRef !== "") {
		params.state.base = {
			commit: resolveCommit(params.options.baseRef),
			ref: params.options.baseRef,
		};
	}

	writeState(params.state);
}

interface ExecuteIssuePhasesParams {
	attempted: Set<PhaseName>;
	eval_: EvaluationResult;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	options?: {
		baseRef?: string;
		force?: true | PhaseName;
		phase?: PhaseName;
		singleSession?: boolean;
	};
	/** Live config follower shared by all three phases of this issue. */
	reloader: ConfigReloader;
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
		worktreePath: string;
	};
	sharedArgs: SharedPromptArgs;
	state: PhaseState;
	steps: Record<AgentPhaseName, ResolvedAgentStep>;
}

/**
 * Re-evaluates a single phase against current on-disk state. Later phases depend on artifacts
 * produced by earlier ones (plan → commits), so a pre-flight evaluation made before design runs is
 * not a valid decision for implement/review once design finishes.
 */
function reEvaluatePhase(params: ExecuteIssuePhasesParams, phase: PhaseName): PhaseDecision {
	/*
	 * The live selection, so a phase that has not started yet is judged against the model it would
	 * actually run on. The model is no longer a *reason* to re-run a finished phase — only `--force`
	 * is — but a fresh evaluation still has to be computed from something, and this is the honest
	 * value rather than the one the run launched with.
	 */
	const steps = params.reloader.steps();
	return evaluatePhases(
		params.issueNumber,
		{
			design: steps.design.model,
			implement: steps.implement.model,
			review: steps.review.model,
		},
		{
			baseRef: params.options?.baseRef,
			force: params.options?.force,
			phase: params.options?.phase,
			resume: true,
			worktree: params.sandbox.worktreePath,
		},
	)[phase];
}

/**
 * How the three phases share an agent session.
 *
 * Split mode (the default) omits both fields, so each phase keeps its own session scope and gets an
 * empty `{{SESSION_NOTE}}` — byte-identical to the behavior before single-session mode existed.
 * Chained mode points every phase at one scope (so each resumes what the last left behind) and
 * tells the agent, per phase, what it is about to inherit.
 */
interface PhaseSession {
	/**
	 * Per-phase prompt paragraph for `{{SESSION_NOTE}}`; empty strings in split mode.
	 *
	 * The text differs per phase because the same sentence is wrong at different points: the design
	 * turn has written nothing yet, while the review turn has written everything it is judging.
	 */
	notes: Record<PhaseName, string>;
	/**
	 * Shared session-store scope in chained mode, or `undefined` to keep the per-phase scope.
	 *
	 * A phase only resumes when this scope holds a session for the same backend; otherwise it
	 * starts fresh and warns, which is the documented degradation.
	 */
	scope?: string;
}

const splitSession: PhaseSession = {
	notes: { design: "", implement: "", review: "" },
};

/**
 * - Decides whether the phases chain, and builds the note that says so.
 * - @param params - Issue number, resolved steps, and the requested mode.
 * - @returns The shared scope and per-phase prompt notes, or an empty session for split mode.
 * - @remarks A chain nobody asked for is silently absent. A _requested_ one that cannot happen (a
 *   phase backend without resume) is refused by the CLI for a flag, and warned about here for a
 *   config default, because a repository preference should not abort every lane over one profile.
 */
function resolvePhaseSession(params: {
	issueNumber: string;
	requested: boolean;
	steps: Record<AgentPhaseName, ResolvedAgentStep>;
}): PhaseSession {
	if (!params.requested) {
		return splitSession;
	}

	const unable = phaseNames.filter(
		(phase) => !backendSupportsResume(params.steps[phase].agentBackend),
	);
	if (unable.length > 0) {
		const named = unable
			.map((phase) => `${phase} (${params.steps[phase].agentBackend})`)
			.join(", ");
		console.warn(
			`  ⚠ agents.singleSession is set, but ${named} cannot resume a session (only ${resumableBackends.join(" and ")} can); running split.`,
		);
		return splitSession;
	}

	return {
		notes: {
			design: "After this plan, you will implement it and then review your own work — all in this same conversation. Write the plan for your future self, not for a stranger: it must be complete enough that a later turn of yours can execute it without re-deriving the reasoning behind it.",
			implement:
				"The plan you are implementing was written earlier in this conversation, by you. Treat it as the decided direction rather than a proposal to re-litigate, and if you must depart from it, say why in your final response instead of silently changing course.",
			review: "This conversation already contains the plan you wrote and the implementation you committed, along with every decision behind both. You are reviewing your own work: read the diff adversarially and be skeptical of the reasoning you just produced, rather than restating it as justification.",
		},
		scope: `${params.issueNumber}.session`,
	};
}

async function executeIssuePhases(params: ExecuteIssuePhasesParams): Promise<void> {
	const session = resolvePhaseSession({
		issueNumber: params.issueNumber,
		requested: params.options?.singleSession ?? config.agents.singleSession,
		steps: params.steps,
	});
	if (session.scope !== undefined) {
		console.log(`
▶ Single session: design → implement → review (#${params.issueNumber})`);
	}

	const context: IssuePhaseContext = {
		...(params.options?.baseRef === undefined || params.options.baseRef === ""
			? {}
			: { baseRef: params.options.baseRef }),
		issueLabels: params.issueLabels,
		issueNumber: params.issueNumber,
		logPath: params.logPath,
		reloader: params.reloader,
		sandbox: params.sandbox,
		session,
		sharedArgs: params.sharedArgs,
		state: params.state,
	};

	for (const def of issuePhaseDefs) {
		/*
		 * Design keeps the pre-flight answer, and that is load-bearing: a fresh `--issue N` (no
		 * `--resume`, no `--phase`) starts from `createFreshPhaseEvaluation`, so it re-plans even when
		 * a plan file is still on disk from an earlier run. Re-deriving design's answer from on-disk
		 * state would skip that re-plan and quietly turn a fresh run into a resume.
		 *
		 * Every later phase is re-evaluated instead: design produces the plan implement needs and
		 * implement produces the commits review needs, so an answer computed before the run started is
		 * not a valid one for the phase that follows it.
		 */
		const decision =
			def.name === "design" ? params.eval_.design : reEvaluatePhase(params, def.name);
		if (decision === "skip") {
			console.log(`
── Phase ${String(def.position)}: ${def.label} — SKIPPED ──`);
			def.after?.(context);
			continue;
		}

		const gate = def.shouldRun?.(context, decision) ?? { run: true };
		if (!gate.run) {
			gate.record();
			continue;
		}

		params.attempted.add(def.name);
		await runIssuePhase(def, context);
		def.after?.(context);
	}

	if (
		!params.options?.phase &&
		(params.state.phases.implement.status !== "done" || !isReviewComplete(params.state))
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

	/*
	 * A skipped implement is still the phase that failed when design reported success: there is
	 * nothing to review, so blaming review sends the operator to the wrong phase. This is the
	 * shape a plan written outside the worktree produced - design "done", implement "skipped",
	 * review "failed".
	 */
	if (state.phases.implement.status !== "done") {
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
		/** Emits setup progress lines; `--json` callers pass a stderr sink. */
		emit?: EmitLine;
		force?: true | PhaseName;
		ignoreSetup?: boolean;
		phase?: PhaseName;
		/** Catalog profile the run is bound to, so a reload recomputes through the same profile. */
		queueProfile?: string;
		resume?: boolean;
		setupOutput?: SetupOutput;
		/** Chain design → implement → review through one agent session; defaults to config. */
		singleSession?: boolean;
		skipSetup?: boolean;
		/**
		 * Raw per-step CLI overrides, distinct from the resolved `steps`.
		 *
		 * The live reloader needs them to keep an explicit `--implement-model` on a step the
		 * operator did not later change in the config file. Callers that pass a pre-resolved
		 * `steps` map without this get config-only reloading, which is the documented degradation.
		 */
		stepOverrides?: AgentStepsConfig;
		steps?: Record<AgentPhaseName, ResolvedAgentStep>;
		worktree?: string;
	},
): Promise<void> {
	const suppliedWorktree =
		options?.worktree !== undefined && options.worktree !== ""
			? validateExistingWorktree(options.worktree)
			: undefined;
	const branchName = suppliedWorktree?.branch ?? issueBranch(issueNumber);
	/*
	 * The repo-root plan directory still exists for `--phase` runs, which can write a plan
	 * before any worktree commit carries it; `plansDir` is created below for that reason.
	 */
	const logPath = pathResolve(logsDir, `issue-${issueNumber}.log`);

	mkdirSync(logsDir, { recursive: true });
	mkdirSync(plansDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });

	const resume = options?.resume ?? false;
	const workflowBackend = options?.agentBackend ?? "dirac";
	const fallbackSteps: Record<AgentPhaseName, ResolvedAgentStep> = {
		design: {
			agentBackend: workflowBackend,
			effort: effort as ResolvedAgentStep["effort"],
			model,
		},
		implement: {
			agentBackend: workflowBackend,
			effort: effort as ResolvedAgentStep["effort"],
			model,
		},
		integrationReview: {
			agentBackend: workflowBackend,
			effort: effort as ResolvedAgentStep["effort"],
			model,
		},
		planner: {
			agentBackend: workflowBackend,
			effort: effort as ResolvedAgentStep["effort"],
			model,
		},
		resolve: {
			agentBackend: workflowBackend,
			effort: effort as ResolvedAgentStep["effort"],
			model,
		},
		review: {
			agentBackend: workflowBackend,
			effort: effort as ResolvedAgentStep["effort"],
			model,
		},
	};
	const steps = options?.steps ?? fallbackSteps;
	/*
	 * The live follower every phase reads its selection from. Built from the launch selection rather
	 * than the resolved `steps`, so its "was this the operator's own flag?" answer stays truthful: a
	 * value that came from the config file has to be allowed to move when the file changes, and one
	 * that came from `--model` must not.
	 */
	const reloader = new ConfigReloader(
		launchSelection({
			agentBackend: workflowBackend,
			effort: effort as SandcastleEffort,
			model,
			...(options?.queueProfile === undefined ? {} : { queueProfile: options.queueProfile }),
			steps: options?.stepOverrides ?? {},
		}),
	);
	const models = {
		design: steps.design.model,
		implement: steps.implement.model,
		review: steps.review.model,
	};
	const eval_ =
		resume || options?.phase
			? evaluatePhases(issueNumber, models, {
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

	/*
	 * Absolute, and inside the worktree the agents run in. A relative
	 * `<config.dir>/plans/<n>.md` put the meaning of that path in the agent's hands: a
	 * designer whose cwd is the worktree listed an empty state directory, concluded "repo
	 * root", and wrote to `<repo>/plans/<n>.md` - a third path neither reader looked at, so
	 * implement skipped as "design phase needed" right after design reported success.
	 */
	const worktreePath = suppliedWorktree?.path ?? worktreePathForBranch(branchName);
	const baseRef = options?.baseRef ?? config.baseBranch;
	// Explicit annotation: SETUP_NOTE is assigned after setup runs, below.
	const sharedArgs: SharedPromptArgs = {
		BASE_REF: baseRef,
		BRANCH: branchName,
		ISSUE_NUMBER: issueNumber,
		ISSUE_TITLE: issueTitle,
		PLAN_PATH: worktreePlanPath(worktreePath, issueNumber),
		SKILLS: skillsForPrompt("design", issueLabels),
	};

	/*
	 * A persistent worktree is reused as-is across runs, so its branch can lag far behind a base
	 * that has since moved — the state #498 ran in, where a 144-commit-stale base made setup
	 * crash on a bug main had already fixed. The banner above prints on every resume/--phase run,
	 * so this is the one checkpoint where the operator is guaranteed to be looking.
	 */
	if (existsSync(worktreePath)) {
		const staleCommits = countStaleCommits(worktreePath, baseRef);
		if (staleCommits > 0) {
			console.warn(
				`  ⚠ Worktree is ${String(staleCommits)} commits behind ${baseRef} — phases run against a stale base.`,
			);
		}
	}

	const state = createOrLoadIssueState({
		branchName,
		effort,
		issueNumber,
		model,
		options,
		steps,
	});
	syncIssueStateOnResume({ effort, model, options, resume, state, steps });

	const sandbox = await createIssueSandbox(branchName, suppliedWorktree, options?.baseRef);
	const attempted = new Set<PhaseName>();
	try {
		if (eval_.design !== "skip" || eval_.implement !== "skip" || eval_.review !== "skip") {
			const setupNote = prepareIssueWorktree(
				sandbox.worktreePath,
				options?.ignoreSetup,
				options?.skipSetup,
				baseRef,
				{ emit: options?.emit, output: options?.setupOutput },
			);

			/*
			 * The prompt files interpolate `{{SETUP_NOTE}}` verbatim, so the key must exist even when
			 * setup succeeded — a missing key would leave a literal placeholder in the instructions.
			 * When setup did fail, the agent gets the failure line up front instead of rediscovering
			 * it by burning its budget on free diagnostic work.
			 */
			sharedArgs.SETUP_NOTE = setupNoteFor(setupNote);
		}

		await executeIssuePhases({
			attempted,
			eval_,
			issueLabels,
			issueNumber,
			logPath,
			options,
			reloader,
			sandbox,
			sharedArgs,
			state,
			steps,
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
	skipSetup = false,
	steps?: Record<AgentPhaseName, ResolvedAgentStep>,
	setupOutput?: SetupOutput,
): Promise<void> {
	console.log("Planning: analysing open issues for dependencies...\n");
	const marker = markerPath("planner");
	clearMarker(marker);

	const plannerStep = steps?.planner ?? {
		agentBackend,
		effort: effort as ResolvedAgentStep["effort"],
		model,
	};
	const planResult = await runPhaseWithRetry(
		() =>
			runSessioned(
				{ backend: plannerStep.agentBackend, scope: "planner" },
				({ capture, resumed }) =>
					io.run({
						agent: createAgent(
							plannerStep.agentBackend,
							plannerStep.model,
							plannerStep.effort,
							marker,
							{
								scope: "planner",
							},
						),
						maxIterations: 1,
						name: "planner",
						output: Output.object({ schema: PlanSchema, tag: "plan" }),
						promptArgs: {
							...completionPromptArgs(marker, {
								before: "the `<plan>` block is printed",
							}),
							READY_LABEL: config.labels.readyForAgent,
							SETUP_NOTE: "",
						},
						promptFile: config.prompts.planAll,
						...(resumed !== undefined ? { resumeSession: resumed.sessionId } : {}),
						...(capture !== undefined
							? {
									logging: {
										type: "file",
										onAgentStreamEvent: (event: AgentStreamEvent): void => {
											if (event.type !== "raw") {
												return;
											}

											capture.onStreamLine(event.line);
											const sessionId = capture.sessionId();
											if (sessionId !== undefined) {
												// Write-through: durable before the first turn completes.
												saveSession("planner", {
													backend: plannerStep.agentBackend,
													sessionId,
												});
											}
										},
										path: pathResolve(logsDir, "planner.log"),
										verbose: true,
									} satisfies LoggingOption,
								}
							: {}),
						sandbox: sandboxProvider,
					}),
			),
		"planner",
	);

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
						setupOutput,
						skipSetup,
						...(steps ? { steps } : {}),
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

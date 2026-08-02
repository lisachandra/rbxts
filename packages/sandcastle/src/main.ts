// oxlint-disable typescript/no-non-null-assertion, typescript/no-unnecessary-condition, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-argument -- Sandcastle bridges dynamic agent/tool JSON at a Node runtime boundary.
/*
 * Three-phase Sandcastle runner: Design → Implement → Review.
 *
 *   Phase 1 (Design):    A thinking agent analyses the issue, explores the
 *                        codebase, and writes a TDD plan to
 *                        .sandcastle/plans/<id>.md (gitignored).
 *   Phase 2 (Implement): An agent reads the plan and implements RED+GREEN
 *                        slices on the branch (up to 100 iterations).
 *   Phase 3 (Review):    A thinking agent reviews the diff against the plan
 *                        and project standards, fixes issues, then comments
 *                        on the GitHub issue.
 *
 * All three phases share the same persistent worktree, so the plan file and
 * git commits persist across phases. Worktree lifecycle is managed here rather
 * than through createSandbox(), whose automatic prune/cleanup is disabled for
 * this runner.
 *
 * Usage:
 *   pnpm sandcastle:issue -- --issue <number>
 *   pnpm sandcastle:issue -- --issue all        # plan + dispatch unblocked issues
 *   pnpm sandcastle:issue -- --issue <number> --dry-run
 *   pnpm sandcastle:issue -- --issue <number> --resume           # resume from last incomplete phase
 *   pnpm sandcastle:issue -- --issue <number> --resume --model X # resume with a different model
 *   pnpm sandcastle:issue -- --issue <number> --phase implement  # run only one phase
 *   pnpm sandcastle:issue -- --issue <number> --force design     # force re-run a phase
 *   pnpm sandcastle:issue -- --issue <number> --status           # print phase evaluation
 */

import {
	type AgentProvider,
	Output,
	pi,
	type PrintCommand,
	run,
	type SandboxRunOptions,
	type SandboxRunResult,
} from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

import { execFileSync, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { escapeRegExp, loadConfig } from "./config.js";

const sandcastleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = pathResolve(sandcastleDir, "..");
/** The repository the runner operates on; always the process working directory. */
const repoRoot = process.cwd();
const config = loadConfig(repoRoot);
const logsDir = pathResolve(repoRoot, config.dir, "logs");
const plansDir = pathResolve(repoRoot, config.dir, "plans");
const stateDir = pathResolve(repoRoot, config.dir, "state");
const integrationsDir = pathResolve(repoRoot, config.dir, "integrations");
const sandcastleEnvPath = pathResolve(repoRoot, config.dir, ".env");
const mainModulePath = fileURLToPath(import.meta.url);

// Load Sandcastle configuration without replacing variables exported by the shell.
if (existsSync(sandcastleEnvPath)) {
	loadEnvFile(sandcastleEnvPath);
}

/**
 * Injectable I/O boundary so unit tests can stub git/gh/agents/exit without rewriting the runner.
 * Production keeps the real Node/sandcastle implementations.
 */
export const io = {
	execFileSync: ((...args: Parameters<typeof execFileSync>) =>
		execFileSync(...args)) as typeof execFileSync,
	execSync: ((...args: Parameters<typeof execSync>) => execSync(...args)) as typeof execSync,
	exit: (code: number): never => process.exit(code),
	// Narrow pi's return type so the unexported AgentSessionStorage name does not leak.
	pi: ((...args: Parameters<typeof pi>) => pi(...args)) as (
		...args: Parameters<typeof pi>
	) => AgentProvider,
	run: (async (...args: Parameters<typeof run>) => run(...args)) as typeof run,
	sleep: async (ms: number): Promise<void> => {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});
	},
};

type IntegrationKind = "issues" | "integrations";
type IntegrationStatus =
	| "created"
	| "merging"
	| "aborted"
	| "reviewing"
	| "integrated"
	| "review-passed"
	| "review-failed"
	| "preflight-failed"
	| "ready-for-human-merge"
	| "conflict-resolution-required";

interface IntegrationSource {
	branch: string;
	commit: string;
	issue?: string;
	name: string;
	order: number;
}

interface IntegrationManifest {
	allowUnreviewed?: boolean;
	base: { commit: string; ref: string };
	branch: string;
	createdAt: string;
	currentSource?: number;
	headCommit?: string;
	kind: IntegrationKind;
	lastError?: string;
	name: string;
	sources: Array<IntegrationSource>;
	status: IntegrationStatus;
	updatedAt: string;
	worktree: string;
}

export const integrationBranch = (name: string): string => `sandcastle/integration/${name}`;

function integrationManifestPath(name: string): string {
	return pathResolve(integrationsDir, name, "manifest.json");
}

export function assertIntegrationName(name: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
		throw new Error(
			`Invalid integration name ${JSON.stringify(name)}; use letters, numbers, ., _, or -`,
		);
	}
}

function git(args: ReadonlyArray<string>, cwd = repoRoot): string {
	return io
		.execFileSync("git", [...args], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		})
		.toString()
		.trim();
}

function gitTry(args: ReadonlyArray<string>, cwd = repoRoot): string | undefined {
	try {
		return git(args, cwd);
	} catch {
		return undefined;
	}
}

export function resolveCommit(ref: string, cwd = repoRoot): string {
	// oxlint-disable-next-line unicorn-js/no-incorrect-template-string-interpolation -- git commit peel syntax
	const commit = git(["rev-parse", "--verify", `${ref}^{commit}`], cwd);
	if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
		throw new Error(`Git ref did not resolve to a commit: ${ref}`);
	}

	return commit;
}

export function commitExists(commit: string, cwd = repoRoot): boolean {
	// oxlint-disable-next-line unicorn-js/no-incorrect-template-string-interpolation -- git commit peel syntax
	return gitTry(["cat-file", "-e", `${commit}^{commit}`], cwd) !== undefined;
}

export function readIntegrationManifest(name: string): undefined | IntegrationManifest {
	const path = integrationManifestPath(name);
	if (!existsSync(path)) {
		return undefined;
	}

	try {
		return JSON.parse(readFileSync(path, "utf-8")) as IntegrationManifest;
	} catch {
		throw new Error(`Integration manifest is invalid: ${path}`);
	}
}

export function writeIntegrationManifest(manifest: IntegrationManifest): void {
	mkdirSync(dirname(integrationManifestPath(manifest.name)), { recursive: true });
	manifest.updatedAt = new Date().toISOString();
	writeFileSync(
		integrationManifestPath(manifest.name),
		`${JSON.stringify(manifest, undefined, 2)}\n`,
		"utf-8",
	);
}

function integrationBasePath(manifest: IntegrationManifest): string {
	return pathResolve(integrationsDir, manifest.name, "worktree");
}

function hasUnmergedPaths(worktree: string): boolean {
	return git(["diff", "--name-only", "--diff-filter=U"], worktree).length > 0;
}

function mergeHeadPath(worktree: string): string {
	const gitDir = git(["rev-parse", "--git-dir"], worktree);
	const absoluteGitDir =
		/^[A-Za-z]:[\\/]/.test(gitDir) || gitDir.startsWith("/")
			? gitDir
			: pathResolve(worktree, gitDir);
	return pathResolve(absoluteGitDir, "MERGE_HEAD");
}

const mergeInProgress = (worktree: string): boolean => existsSync(mergeHeadPath(worktree));

function assertCleanMergeResolution(manifest: IntegrationManifest): void {
	const worktree = integrationBasePath(manifest);
	if (hasUnmergedPaths(worktree)) {
		throw new Error(
			`Unmerged paths remain in ${worktree}; resolve every conflict before continuing.`,
		);
	}

	if (mergeInProgress(worktree)) {
		git(["commit", "--no-edit"], worktree);
	}
}

/** Link repository-local directories (docs, agent rules, assets) into a sandbox worktree. */
function linkSymlinks(worktreePath: string): void {
	for (const link of config.symlinks) {
		const linkPath = pathResolve(worktreePath, link.path);
		const targetPath = pathResolve(repoRoot, link.target);

		if (!existsSync(targetPath)) {
			console.warn(`  ⚠ ${link.target} not found at ${targetPath}; skipping symlink.`);
			continue;
		}

		try {
			if (existsSync(linkPath) || lstatSync(linkPath, { throwIfNoEntry: false })) {
				continue;
			}

			symlinkSync(targetPath, linkPath, "junction");
			console.log(`  ✓ Linked ${link.path} → ${targetPath}`);
		} catch (err) {
			console.warn(`  ⚠ Could not link ${link.path}: ${String(err)}`);
		}
	}
}

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

/*
 * ---------------------------------------------------------------------------
 * Phase state tracking
 * ---------------------------------------------------------------------------
 */

type PhaseName = "design" | "review" | "implement";
type AgentBackend = "pi" | "dirac";

type SandcastleEffort = "low" | "high" | "xhigh" | "medium" | "max";
type PhaseStatus = "done" | "failed" | "skipped";
type PhaseDecision = "skip" | "start" | "force";

interface PhaseRecord {
	/**
	 * Design: path to plan file. Implement: list of commit SHAs. Review: whether comment was
	 * posted.
	 */
	extra?: Record<string, unknown>;
	status: PhaseStatus;
	timestamp: string;
}

interface PhaseState {
	base?: { commit: string; ref: string };
	branch: string;
	effort: string;
	issue: string;
	lastError?: string;
	model: string;
	phases: Record<PhaseName, PhaseRecord>;
}

const statePath = (issue: string): string => pathResolve(stateDir, `${issue}.json`);

export function readState(issue: string): undefined | PhaseState {
	const p = statePath(issue);
	if (!existsSync(p)) {
		return undefined;
	}

	try {
		return JSON.parse(readFileSync(p, "utf-8")) as PhaseState;
	} catch {
		return undefined;
	}
}

export function writeState(state: PhaseState): void {
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(statePath(state.issue), `${JSON.stringify(state, undefined, 2)}\n`, "utf-8");
}

export function updatePhase(
	state: PhaseState,
	phase: PhaseName,
	status: PhaseStatus,
	extra?: Record<string, unknown>,
): void {
	state.phases[phase] = { extra, status, timestamp: new Date().toISOString() };
	writeState(state);
}

/*
 * ---------------------------------------------------------------------------
 * Phase evaluator
 * ---------------------------------------------------------------------------
 */

interface SharedPromptArgs {
	[key: string]: string | undefined;
	BASE_REF?: string;
	BRANCH?: string;
	COMPLETION_SIGNAL: string;
	ISSUE_NUMBER?: string;
	ISSUE_TITLE?: string;
	PLAN_PATH?: string;
	READY_LABEL?: string;
	SKILLS: string;
}

interface EvaluationResult {
	design: PhaseDecision;
	implement: PhaseDecision;
	reasons: Record<PhaseName, string>;
	review: PhaseDecision;
}

/**
 * Evaluates the actual artifacts on disk to decide skip/start/force for each phase. Resilient to
 * stale state files — checks plan files, commits, and build status.
 */
export function evaluatePhases(
	issueNumber: string,
	model: string,
	opts: {
		baseRef?: string;
		force?: true | PhaseName;
		phase?: PhaseName;
		resume: boolean;
		worktree?: string;
	},
): EvaluationResult {
	void opts.resume;
	const planFile = pathResolve(repoRoot, config.dir, "plans", `${issueNumber}.md`);
	const worktreePath =
		opts.worktree ??
		pathResolve(repoRoot, config.dir, "worktrees", `sandcastle-issue-${issueNumber}`);
	const state = readState(issueNumber);
	const baseRef = opts.baseRef ?? state?.base?.ref ?? config.baseBranch;
	const reasons: Record<PhaseName, string> = { design: "", implement: "", review: "" };

	// If --phase is specified, only evaluate that phase; skip the others.
	if (opts.phase) {
		const result: EvaluationResult = {
			design: "skip",
			implement: "skip",
			reasons,
			review: "skip",
		};
		result[opts.phase] = evaluateSinglePhase(
			opts.phase,
			issueNumber,
			model,
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		);
		if (opts.force === true || opts.force === opts.phase) {
			result[opts.phase] = "force";
			reasons[opts.phase] = "forced by --force flag";
		}

		return result;
	}

	// Full evaluation of all three phases.
	const result: EvaluationResult = {
		design: evaluateSinglePhase(
			"design",
			issueNumber,
			model,
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		),
		implement: evaluateSinglePhase(
			"implement",
			issueNumber,
			model,
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		),
		reasons,
		review: evaluateSinglePhase(
			"review",
			issueNumber,
			model,
			state,
			planFile,
			worktreePath,
			baseRef,
			reasons,
		),
	};

	// Apply --force override.
	if (opts.force !== undefined) {
		if (opts.force === true) {
			// Force all phases.
			for (const p of ["design", "implement", "review"] as Array<PhaseName>) {
				result[p] = "force";
				reasons[p] = "forced by --force flag";
			}
		} else {
			result[opts.force] = "force";
			reasons[opts.force] = "forced by --force flag";
		}
	}

	return result;
}

function evaluateSinglePhase(
	phase: PhaseName,
	issueNumber: string,
	model: string,
	state: undefined | PhaseState,
	planFile: string,
	worktreePath: string,
	baseRef: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	switch (phase) {
		case "design": {
			return evaluateDesign(state, planFile, worktreePath, reasons);
		}
		case "implement": {
			return evaluateImplement(
				state,
				model,
				planFile,
				worktreePath,
				issueNumber,
				baseRef,
				reasons,
			);
		}
		case "review": {
			return evaluateReview(state, issueNumber, baseRef, worktreePath, reasons);
		}
	}
}

export function evaluateDesign(
	state: undefined | PhaseState,
	planFile: string,
	worktreePath: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	// Check both repo-root and worktree locations for the plan file.
	const planFileName = planFile.split(/[\\/]/).pop()!;
	const worktreePlanFile = pathResolve(worktreePath, config.dir, "plans", planFileName);
	const resolvedPlan = existsSync(planFile)
		? planFile
		: existsSync(worktreePlanFile)
			? worktreePlanFile
			: undefined;

	if (resolvedPlan === undefined || resolvedPlan === "") {
		reasons.design = "plan file does not exist";
		return "start";
	}

	try {
		const content = readFileSync(resolvedPlan, "utf-8").trim();
		if (content.length === 0) {
			reasons.design = "plan file is empty";
			return "start";
		}

		// Check for expected structure — at minimum a heading.
		if (!content.includes("#") && !content.includes("##")) {
			reasons.design = "plan file has no headings (possibly malformed)";
			return "start";
		}
	} catch {
		reasons.design = "plan file unreadable";
		return "start";
	}

	// Plan file exists and looks valid.
	if (state?.phases.design.status === "done") {
		reasons.design = `plan file exists at ${resolvedPlan} and design phase marked done`;
		return "skip";
	}

	reasons.design = `plan file exists at ${resolvedPlan} (state file missing or incomplete)`;
	return "skip";
}

export function evaluateImplement(
	state: undefined | PhaseState,
	model: string,
	planFile: string,
	worktreePath: string,
	_issueNumber: string,
	baseRef: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	// Design must be done first — check both repo-root and worktree.
	const planFileName = planFile.split(/[\\/]/).pop()!;
	const worktreePlanFile = pathResolve(worktreePath, config.dir, "plans", planFileName);
	if (!existsSync(planFile) && !existsSync(worktreePlanFile)) {
		reasons.implement = "blocked — plan file does not exist (design phase needed)";
		return "skip";
	}

	// Check if worktree exists.
	if (!existsSync(worktreePath)) {
		reasons.implement = "worktree does not exist";
		return "start";
	}

	// Check for commits beyond the base branch.
	const newCommits = countNewCommits(worktreePath, baseRef);
	if (newCommits === 0) {
		reasons.implement = "no new commits in worktree";
		return "start";
	}

	// If model changed, restart implementation.
	if (state?.phases.implement.status === "done" && state.model !== model) {
		reasons.implement = `model changed (${state.model} → ${model})`;
		return "start";
	}

	// Check if build passes.
	if (state?.phases.implement.status === "done") {
		reasons.implement = `${newCommits} commits, build previously passed`;
		return "skip";
	}

	// State says failed — restart.
	if (state?.phases.implement.status === "failed") {
		reasons.implement = `previous attempt failed: ${state.lastError ?? "unknown error"}`;
		return "start";
	}

	// No state file but commits exist — likely a partial run.
	reasons.implement = `${newCommits} commits exist but no state record`;
	return "start";
}

export function evaluateReview(
	state: undefined | PhaseState,
	_issueNumber: string,
	baseRef: string,
	worktreePath: string,
	reasons: Record<PhaseName, string>,
): PhaseDecision {
	// Implement must have produced commits.
	if (state?.phases.implement.status !== "done") {
		// Check if there are commits anyway (state might be stale).
		if (!existsSync(worktreePath) || countNewCommits(worktreePath, baseRef) === 0) {
			reasons.review = "blocked — implementation has no commits";
			return "skip";
		}

		reasons.review = "implementation has commits (state file missing)";
		return "start";
	}

	// Already reviewed.
	if (state?.phases.review.status === "done") {
		reasons.review = "review already completed";
		return "skip";
	}

	reasons.review = "implementation done, review needed";
	return "start";
}

export function validateExistingWorktree(worktreePath: string): {
	branch: string;
	commit: string;
	path: string;
} {
	const path = pathResolve(worktreePath);
	if (!existsSync(path) || !lstatSync(path).isDirectory()) {
		throw new Error(`Worktree does not exist: ${path}`);
	}

	if (normalizedPath(path) === normalizedPath(repoRoot)) {
		throw new Error("--worktree cannot target the repository root.");
	}

	const registered = registeredWorktrees().find(
		(worktree) => normalizedPath(worktree.path) === normalizedPath(path),
	);
	if (!registered) {
		throw new Error(`Path is not a registered Git worktree: ${path}`);
	}

	const branch = registered.branch ?? checkoutBranch(path);
	if (branch === undefined || branch === "") {
		throw new Error(`Worktree is detached: ${path}`);
	}

	const commit = resolveCommit("HEAD", path);
	if (git(["status", "--porcelain"], path).length > 0) {
		throw new Error(`Worktree is dirty; refusing to append: ${path}`);
	}

	return { branch, commit, path };
}

export function countNewCommits(worktreePath: string, baseRef: string): number {
	try {
		const output = io
			.execSync(`git rev-list --count HEAD --not ${baseRef}`, {
				cwd: worktreePath,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 5000,
			})
			.toString()
			.trim();
		return Number(output);
	} catch {
		return 0;
	}
}

/*
 * ---------------------------------------------------------------------------
 * Rate limit detection & retry
 * ---------------------------------------------------------------------------
 */

export function isRateLimitError(err: unknown): boolean {
	const msg = String(err).toLowerCase();
	return (
		msg.includes("429") ||
		msg.includes("rate_limit") ||
		msg.includes("rate limit") ||
		msg.includes("too many requests") ||
		msg.includes("quota exceeded") ||
		msg.includes("resource_exhausted")
	);
}

/**
 * Wraps a sandbox.run() call with retry logic for rate-limit errors. Other errors propagate
 * immediately.
 *
 * @rejects {Error} When the phase fails for a non-rate-limit reason or retries are exhausted.
 */
export async function runPhaseWithRetry(
	sandboxRun: () => Promise<{ commits: Array<{ sha: string }>; stdout: string }>,
	phaseName: string,
	maxRetries = 3,
): Promise<{ commits: Array<{ sha: string }>; stdout: string }> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await sandboxRun();
		} catch (err) {
			if (isRateLimitError(err) && attempt < maxRetries) {
				const backoff = 30 * attempt;
				console.warn(
					`  ⚠ Rate limited during ${phaseName}. Retrying in ${backoff}s (attempt ${attempt}/${maxRetries})...`,
				);
				await io.sleep(backoff * 1000);
				continue;
			}

			throw err;
		}
	}

	throw new Error("unreachable");
}

/*
 * ---------------------------------------------------------------------------
 * Status printer
 * ---------------------------------------------------------------------------
 */

export function printStatus(
	issueNumber: string,
	model: string,
	baseRef?: string,
	worktree?: string,
): void {
	const branchName = `sandcastle/issue-${issueNumber}`;
	const worktreePath =
		worktree ??
		pathResolve(repoRoot, config.dir, "worktrees", `sandcastle-issue-${issueNumber}`);
	const state = readState(issueNumber);

	// Fetch issue title.
	let issueTitle = "";
	try {
		issueTitle = io
			.execSync(`${issueView(issueNumber)} --json title --jq .title`, {
				encoding: "utf-8",
			})
			.toString()
			.trim();
	} catch {
		issueTitle = "(could not fetch)";
	}

	const eval_ = evaluatePhases(issueNumber, model, { baseRef, resume: true });

	console.log(`\nIssue #${issueNumber}: ${issueTitle}`);
	console.log(`Branch: ${branchName}`);
	console.log(`Worktree: ${existsSync(worktreePath) ? "exists" : "missing"}`);
	const stateModelNote =
		state !== undefined && state.model !== model ? ` (state: ${state.model})` : "";
	console.log(`Model: ${model}${stateModelNote}`);
	console.log();

	// Table header.
	console.log(`${"Phase".padEnd(12)} ${"Status".padEnd(10)} ${"Decision".padEnd(10)} Reason`);
	console.log(`${"─".repeat(12)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(40)}`);

	for (const phase of ["design", "implement", "review"] as Array<PhaseName>) {
		const record = state?.phases[phase];
		const status = record?.status ?? "pending";
		const decision = eval_[phase];
		const reason = eval_.reasons[phase];
		console.log(
			`${phase.padEnd(12)} ${status.padEnd(10)} ${decision.toUpperCase().padEnd(10)} ${reason}`,
		);
	}

	console.log();
	console.log(`Resume with: pnpm sandcastle:issue -- --issue ${issueNumber} --resume`);
}

/*
 * ---------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------------
 */

type CliCommand =
	| "issue"
	| "merge"
	| "issue-sequence"
	| "integration-abort"
	| "merge-integrations"
	| "integration-status"
	| "integration-resume"
	| "integration-cleanup";

interface CliOptions {
	readonly agentBackend: AgentBackend;
	readonly allowUnreviewed: boolean;
	readonly base: string;
	readonly command: CliCommand;
	readonly concurrency: number;
	readonly dryRun: boolean;
	readonly effort: SandcastleEffort;
	readonly force?: true | PhaseName;
	readonly help: boolean;
	readonly ignoreSetup?: boolean;
	readonly integrationName?: string;
	readonly integrationNames: Array<string>;
	readonly issueNumber: string;
	readonly issueNumbers: Array<string>;
	readonly maxImplementIterations: number;
	readonly model: string;
	readonly phase?: PhaseName;
	readonly resume: boolean;
	readonly sequentialIssues: Array<string>;
	readonly status: boolean;
	readonly worktree?: string;
}

export function commaSeparated(value: string | undefined, flag: string): Array<string> {
	if (value === undefined || value === "") {
		throw new Error(`${flag} requires a value`);
	}

	const values = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	if (values.length === 0) {
		throw new Error(`${flag} requires at least one value`);
	}

	return values;
}

interface ParsedArgState {
	agentBackend: AgentBackend;
	allowUnreviewed: boolean;
	base: string;
	command: CliCommand;
	concurrency: number;
	dryRun: boolean;
	effort: SandcastleEffort;
	force: true | PhaseName | undefined;
	help: boolean;
	ignoreSetup: boolean;
	integrationName: string | undefined;
	integrationNames: Array<string>;
	issueNumber: string | undefined;
	issueNumbers: Array<string>;
	maxImplementIterations: number;
	model: string | undefined;
	phase: PhaseName | undefined;
	resume: boolean;
	sequentialIssues: Array<string>;
	status: boolean;
	worktree: string | undefined;
}

function createParsedArgState(): ParsedArgState {
	return {
		agentBackend: config.agents.default,
		allowUnreviewed: false,
		base: config.baseBranch,
		command: "issue",
		concurrency: 1,
		dryRun: false,
		effort: config.effort,
		force: undefined,
		help: false,
		ignoreSetup: false,
		integrationName: undefined,
		integrationNames: [],
		issueNumber: undefined,
		issueNumbers: [],
		maxImplementIterations: 100,
		model: undefined,
		phase: undefined,
		resume: false,
		sequentialIssues: [],
		status: false,
		worktree: undefined,
	};
}

function isPhaseName(value: string | undefined): value is PhaseName {
	return value === "design" || value === "implement" || value === "review";
}

function isAgentBackend(value: string | undefined): value is AgentBackend {
	return value === "dirac" || value === "pi";
}

function isSandcastleEffort(value: string | undefined): value is SandcastleEffort {
	return (
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
	);
}

function isIntegrationCommand(value: string): value is CliCommand {
	return (
		value === "merge" ||
		value === "merge-integrations" ||
		value === "issue-sequence" ||
		value === "integration-status" ||
		value === "integration-resume" ||
		value === "integration-abort" ||
		value === "integration-cleanup"
	);
}

type ArgHandler = (state: ParsedArgState, next: string | undefined, index: number) => number;

const valueArgHandlers: Record<string, ArgHandler> = {
	"--agent": (state, next, index) => {
		if (!isAgentBackend(next)) {
			throw new Error("--agent must be one of: dirac, pi");
		}

		state.agentBackend = next;
		return index + 1;
	},
	"--base": (state, next, index) => {
		state.base = next ?? state.base;
		return index + 1;
	},
	"--concurrency": (state, next, index) => {
		state.concurrency = Math.max(1, Number(next ?? "1"));
		return index + 1;
	},
	"--effort": (state, next, index) => {
		if (!isSandcastleEffort(next)) {
			throw new Error("--effort must be one of: low, medium, high, xhigh, max");
		}

		state.effort = next;
		return index + 1;
	},
	"--force": (state, next, index) => {
		if (isPhaseName(next)) {
			state.force = next;
			return index + 1;
		}

		state.force = true;
		return index;
	},
	"--integrations": (state, next, index) => {
		state.integrationNames.push(...commaSeparated(next, "--integrations"));
		return index + 1;
	},
	"--issue": (state, next, index) => {
		state.issueNumber = next;
		return index + 1;
	},
	"--issues": (state, next, index) => {
		state.issueNumbers.push(...commaSeparated(next, "--issues"));
		return index + 1;
	},
	"--max-iterations": (state, next, index) => {
		state.maxImplementIterations = Number(next ?? "100");
		return index + 1;
	},
	"--model": (state, next, index) => {
		state.model = next;
		return index + 1;
	},
	"--name": (state, next, index) => {
		state.integrationName = next;
		return index + 1;
	},
	"--phase": (state, next, index) => {
		if (!isPhaseName(next)) {
			throw new Error("--phase must be one of: design, implement, review");
		}

		state.phase = next;
		return index + 1;
	},
	"--sequential": (state, next, index) => {
		state.sequentialIssues.push(...commaSeparated(next, "--sequential"));
		return index + 1;
	},
	"--worktree": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--worktree requires an existing path");
		}

		state.worktree = pathResolve(next);
		return index + 1;
	},
	"-c": (state, next, index) => {
		state.concurrency = Math.max(1, Number(next ?? "1"));
		return index + 1;
	},
	"-i": (state, next, index) => {
		state.issueNumber = next;
		return index + 1;
	},
};

const booleanArgHandlers: Record<string, (state: ParsedArgState) => void> = {
	"--allow-unreviewed": (state) => {
		state.allowUnreviewed = true;
	},
	"--dry-run": (state) => {
		state.dryRun = true;
	},
	"--help": (state) => {
		state.help = true;
	},
	"--ignore-setup": (state) => {
		state.ignoreSetup = true;
	},
	"--resume": (state) => {
		state.resume = true;
	},
	"--status": (state) => {
		state.status = true;
	},
	"-h": (state) => {
		state.help = true;
	},
};

function applyParsedArgument(
	state: ParsedArgState,
	arg: string,
	next: string | undefined,
	index: number,
): number {
	if (arg === "--") {
		return index;
	}

	if (isIntegrationCommand(arg)) {
		if (state.command !== "issue" || state.issueNumber !== undefined) {
			throw new Error("Only one Sandcastle command may be specified");
		}

		state.command = arg;
		return index;
	}

	const booleanHandler = booleanArgHandlers[arg];
	if (booleanHandler !== undefined) {
		booleanHandler(state);
		return index;
	}

	const valueHandler = valueArgHandlers[arg];
	if (valueHandler !== undefined) {
		return valueHandler(state, next, index);
	}

	if (state.issueNumber === undefined && state.command === "issue" && !arg.startsWith("-")) {
		state.issueNumber = arg;
		return index;
	}

	throw new Error(`Unknown argument: ${arg}`);
}

function finalizeParsedArgs(state: ParsedArgState): CliOptions {
	if (state.issueNumbers.length > 0 && state.integrationNames.length > 0) {
		throw new Error(
			"Do not combine --issues and --integrations; choose one integration operation.",
		);
	}

	if (state.command === "merge" && state.integrationNames.length > 0) {
		throw new Error("The merge command accepts --issues, not --integrations.");
	}

	if (state.command === "merge-integrations" && state.issueNumbers.length > 0) {
		throw new Error("The merge-integrations command accepts --integrations, not --issues.");
	}

	if (
		state.worktree !== undefined &&
		state.worktree !== "" &&
		(state.command === "merge" ||
			state.command === "merge-integrations" ||
			state.command.startsWith("integration-"))
	) {
		throw new Error("--worktree is only supported for issue and issue-sequence workflows.");
	}

	if (
		state.worktree !== undefined &&
		state.worktree !== "" &&
		state.command === "issue" &&
		state.issueNumber === "all"
	) {
		throw new Error("--worktree cannot be used with --issue all.");
	}

	if (!isAgentBackend(state.agentBackend)) {
		throw new Error(`SANDCASTLE_AGENT must be one of: ${config.agents.enabled.join(", ")}`);
	}

	if (!isSandcastleEffort(state.effort)) {
		throw new Error("SANDCASTLE_EFFORT must be one of: low, medium, high, xhigh, max");
	}

	const legacyModelEnvKey =
		state.agentBackend === "dirac" ? "DIRAC_SANDCASTLE_MODEL" : "PI_SANDCASTLE_MODEL";
	const legacyModel = process.env[legacyModelEnvKey]?.trim() ?? "";
	const model =
		state.model?.trim() ??
		config.agents.models[state.agentBackend]?.trim() ??
		(legacyModel !== "" ? legacyModel : undefined);
	if (!state.help && (model === undefined || model === "")) {
		throw new Error(
			`No model configured for ${state.agentBackend}; set agents.models.${state.agentBackend} in sandcastle.config.ts or pass --model <model>.`,
		);
	}

	return {
		agentBackend: state.agentBackend,
		allowUnreviewed: state.allowUnreviewed,
		base: state.base,
		command: state.command,
		concurrency: state.concurrency,
		dryRun: state.dryRun,
		effort: state.effort,
		force: state.force,
		help: state.help,
		ignoreSetup: state.ignoreSetup,
		integrationName: state.integrationName,
		integrationNames: state.integrationNames,
		issueNumber: state.issueNumber ?? "",
		issueNumbers: state.issueNumbers,
		maxImplementIterations: state.maxImplementIterations,
		model: model ?? "",
		phase: state.phase,
		resume: state.resume,
		sequentialIssues: state.sequentialIssues,
		status: state.status,
		worktree: state.worktree,
	};
}

export function parseArgs(argv: ReadonlyArray<string>): CliOptions {
	const state = createParsedArgState();

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === undefined) {
			continue;
		}

		index = applyParsedArgument(state, arg, argv[index + 1], index);
	}

	return finalizeParsedArgs(state);
}

export function printHelp(): void {
	console.log(`Three-phase Sandcastle runner: Design → Implement → Review.

Issue workflow:
  pnpm sandcastle:issue -- --issue <number> [options]
  pnpm sandcastle:issue -- --issue all

Sequential issue workflow:
  pnpm sandcastle:issue -- issue-sequence --sequential 151,150,147 --base sandcastle/issue-100 [options]

  Runs issues sequentially, composing changes from each into the next.
  Previous issue's commits are present when working on the next.
  Automatically aborts if any issue concludes with "blocked" status.

Integration workflow:
  pnpm sandcastle merge --name <name> --issues 123,124 [--base main]
  pnpm sandcastle merge-integrations --name <name> --integrations a,b [--base main]
  pnpm sandcastle integration-status --name <name>
  pnpm sandcastle integration-resume --name <name>
  pnpm sandcastle integration-abort --name <name>
  pnpm sandcastle integration-cleanup --name <name>

Shared options:
      --model <model>        Workflow-wide model; also used for integration review
	      --agent <backend>      dirac | pi (default: dirac)
      --effort <level>       low | medium | high | xhigh | max
      --allow-unreviewed     Explicitly allow sources whose review is incomplete
      --dry-run              Print resolved config without starting an agent
      --force                 Allow cleanup of a dirty integration worktree

Issue options:
  -i, --issue <number>       GitHub issue number (or "all")
      --max-iterations <n>   Max iterations for the implementer (default: 100)
  -c, --concurrency <n>     Max parallel issues for "all" mode (default: 1)
      --resume               Resume from last incomplete phase
      --phase <phase>        Run only one phase (design | implement | review)
      --force [phase]        Force re-run (optionally specify which phase)
      --ignore-setup         Continue even if env/pnpm setup fails
      --status               Print phase evaluation without running
      --worktree <path>      Use an existing registered worktree directly
  -h, --help                 Show this help

Sequential workflow options:
      --sequential <issues>  Comma-separated issue numbers to run sequentially (151,150,147)
      --base <ref>           Base ref/commit/branch to start from (default: main; can be sandcastle/issue-100)
      --worktree <path>      Append in an existing worktree (issue and sequence only)
`);
}

/*
 * ---------------------------------------------------------------------------
 * Phase helpers
 * ---------------------------------------------------------------------------
 */

const sandboxProvider = noSandbox();

interface PersistentSandbox {
	close(): Promise<void>;
	run(options: SandboxRunOptions): Promise<SandboxRunResult>;
	readonly worktreePath: string;
}

interface RegisteredWorktree {
	branch: string | undefined;
	path: string;
}

export function normalizedPath(path: string): string {
	const resolved = pathResolve(path);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function registeredWorktrees(): Array<RegisteredWorktree> {
	return git(["worktree", "list", "--porcelain"])
		.split(/\r?\n\r?\n/)
		.map((block) => {
			const pathLine = block.split(/\r?\n/).find((line) => line.startsWith("worktree "));
			if (pathLine === undefined || pathLine === "") {
				return undefined;
			}

			const branchLine = block.split(/\r?\n/).find((line) => line.startsWith("branch "));
			return {
				branch: branchLine?.slice("branch ".length).replace(/^refs\/heads\//, ""),
				path: pathLine.slice("worktree ".length),
			};
		})
		.filter((worktree): worktree is RegisteredWorktree => worktree !== undefined);
}

export function checkoutBranch(worktreePath: string): string | undefined {
	if (!existsSync(worktreePath)) {
		return undefined;
	}

	const gitDir = gitTry(["-C", worktreePath, "rev-parse", "--git-dir"]);
	if (gitDir === undefined || gitDir === "") {
		return undefined;
	}

	return gitTry(["-C", worktreePath, "symbolic-ref", "--quiet", "--short", "HEAD"]);
}

/** Create or reuse a worktree without invoking Sandcastle's prune lifecycle. */
export function ensurePersistentWorktree(branch: string, baseRef = "HEAD"): string {
	const worktreesDir = pathResolve(repoRoot, config.dir, "worktrees");
	const worktreePath = pathResolve(worktreesDir, branch.replace(/\//g, "-"));
	mkdirSync(worktreesDir, { recursive: true });

	const registered = registeredWorktrees();
	const matchingPath = registered.find(
		(worktree) => normalizedPath(worktree.path) === normalizedPath(worktreePath),
	);
	if (matchingPath) {
		if (matchingPath.branch !== branch) {
			throw new Error(
				`Worktree path ${worktreePath} belongs to branch ${matchingPath.branch ?? "(detached)"}; refusing to prune or replace it.`,
			);
		}

		return worktreePath;
	}

	const matchingBranch = registered.find((worktree) => worktree.branch === branch);
	if (matchingBranch) {
		throw new Error(
			`Branch ${branch} is already checked out at ${matchingBranch.path}; refusing to prune or replace that worktree.`,
		);
	}

	const existingBranch = checkoutBranch(worktreePath);
	if (existingBranch !== undefined && existingBranch !== "") {
		if (existingBranch !== branch) {
			throw new Error(
				`Worktree path ${worktreePath} contains branch ${existingBranch}; refusing to reuse it for ${branch}.`,
			);
		}

		git(["worktree", "repair", worktreePath]);
		return worktreePath;
	}

	if (existsSync(worktreePath) || lstatSync(worktreePath, { throwIfNoEntry: false })) {
		throw new Error(
			`Unregistered worktree path ${worktreePath} exists but is not a valid Git checkout; refusing to replace it.`,
		);
	}

	if (gitTry(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) !== undefined) {
		git(["worktree", "add", worktreePath, branch]);
	} else {
		git(["worktree", "add", "-b", branch, worktreePath, baseRef]);
	}

	return worktreePath;
}

async function createPersistentSandbox(
	branch: string,
	baseRef = "HEAD",
): Promise<PersistentSandbox> {
	const worktreePath = ensurePersistentWorktree(branch, baseRef);
	copyFileSync(pathResolve(repoRoot, ".env"), pathResolve(worktreePath, ".env"));

	return {
		// The worktree intentionally survives every run; only the agent process ends.
		close: async () => undefined,
		run: async (options) =>
			io.run({
				...options,
				branchStrategy: { type: "head" },
				cwd: worktreePath,
				sandbox: sandboxProvider,
			}),
		worktreePath,
	};
}

/*
 * ---------------------------------------------------------------------------
 * Dirac agent provider
 * ---------------------------------------------------------------------------
 */

type DiracStreamEvent =
	| { text: string; type: "text" }
	| { result: string; type: "result" }
	| {
			type: "usage";
			usage: {
				cacheCreationInputTokens: number;
				cacheReadInputTokens: number;
				inputTokens: number;
				outputTokens: number;
			};
	  };

let diracTextBuffer = "";
let diracSignalEmitted = false;
let diracCompletionSignal = "";

export function diracAgent(
	model: string,
	options?: {
		completionSignal?: string;
		effort?: string;
		env?: Record<string, string>;
	},
): AgentProvider {
	// Store the runtime-generated signal for parseStreamLine detection
	diracCompletionSignal = options?.completionSignal ?? "<promise>COMPLETE</promise>";

	// oxlint-disable-next-line typescript/prefer-optional-chain -- Access with index string for env
	let provider = (options?.env ?? {})["OPENAI_API_BASE"] ?? "";
	provider = provider ? `-p ${provider}` : "";

	return {
		captureSessions: false,
		env: options?.env ?? {},
		name: "dirac",

		buildPrintCommand({ dangerouslySkipPermissions, prompt }): PrintCommand {
			const yoloFlag = dangerouslySkipPermissions ? " -y" : "";
			const effortFlag =
				options?.effort !== undefined && options.effort !== ""
					? ` --reasoning-effort ${options.effort}`
					: "";
			const wrapperPath = `${packageRoot}/assets/dirac-wrapper.sh`.replaceAll("\\", "/");
			return {
				/*
				 * The wrapper captures stdin to a temp file and passes it as a CLI
				 * argument with stdin from /dev/null, avoiding Ink's raw-mode error.
				 */
				command: `bash ${wrapperPath} --json${yoloFlag}${effortFlag} ${provider} -m ${JSON.stringify(model)}`,
				stdin: prompt,
			};
		},

		parseStreamLine(line: string): Array<DiracStreamEvent> {
			try {
				const parsed = JSON.parse(line);
				const events: Array<DiracStreamEvent> = [];

				// Reset buffer at the start of a new task
				if (parsed.type === "task_started") {
					diracTextBuffer = "";
					diracSignalEmitted = false;
				}

				if (parsed.content?.type === "markdown" && parsed.content.isReasoning === false) {
					/*
					 * Only accumulate assistant text for signal detection.
					 * User prompt may contain the signal as an example.
					 */
					if (parsed.content.role !== "user") {
						const rawContent = parsed.content.content;
						const newText = typeof rawContent === "string" ? rawContent : "";
						diracTextBuffer += newText;

						/*
						 * Only flag completion when the CURRENT block contains
						 * the signal — avoids false positives from earlier
						 * mentions of the signal lingering in the buffer.
						 */
						if (!diracSignalEmitted && newText.includes(diracCompletionSignal)) {
							diracSignalEmitted = true;
							events.push({ type: "result", result: diracTextBuffer });
						}
					}

					/*
					 * Only emit text events for assistant content.
					 * User prompt text must NOT flow into accumulatedOutput
					 * because it contains the completion UUID, which would
					 * cause the sandcastle library to detect completion
					 * immediately and start the 60s grace timer prematurely.
					 */
					if (parsed.content.role !== "user") {
						events.push({ type: "text", text: parsed.content.content });
					}
				}

				/*
				 * After completion signal is seen, skip card results — they
				 * overwrite resultText and would lose the <plan> content.
				 */
				if (
					!diracSignalEmitted &&
					parsed.content?.type === "card" &&
					parsed.content.card?.body !== undefined &&
					parsed.content.card.body !== ""
				) {
					events.push({ type: "result", result: parsed.content.card.body });
				}

				if (
					parsed.content?.type === "api_status" &&
					parsed.content.status !== undefined &&
					parsed.content.status !== ""
				) {
					const s = parsed.content.status;
					events.push({
						type: "usage",
						usage: {
							cacheCreationInputTokens: s.cacheWrites ?? 0,
							cacheReadInputTokens: s.cacheReads ?? 0,
							inputTokens: s.tokensIn ?? 0,
							outputTokens: s.tokensOut ?? 0,
						},
					});
				}

				return events;
			} catch {
				return [];
			}
		},
	};
}

export function createAgent(
	backend: AgentBackend,
	model: string,
	effort: string,
	completionSignal?: string,
): AgentProvider {
	if (backend === "pi") {
		return io.pi(model, {
			captureSessions: false,
			thinking: effort as "low" | "high" | "xhigh" | "medium",
		});
	}

	return diracAgent(model, {
		completionSignal,
		effort,
		env: {
			OPENAI_API_BASE: process.env["OPENAI_API_BASE"] ?? "https://router.bynara.id/v1",
			OPENAI_API_KEY: process.env["OPENAI_API_KEY"] ?? "",
		},
	});
}

const globalPhaseSkills: Record<PhaseName, ReadonlyArray<string>> = config.skills.defaults;
const issueLabelSkills: Record<string, Partial<Record<PhaseName, ReadonlyArray<string>>>> =
	config.skills.labels;

export const uniqueSkills = (skills: ReadonlyArray<string>): Array<string> => [...new Set(skills)];

export function skillsForPrompt(phase: PhaseName, labels: ReadonlyArray<string> = []): string {
	const skills = [...globalPhaseSkills[phase]];
	for (const label of labels) {
		for (const skill of issueLabelSkills[label]?.[phase] ?? []) {
			skills.push(skill);
		}
	}

	return uniqueSkills(skills)
		.map((skill) => `- ${skill}`)
		.join("\n");
}

/** Returns the configured issue-view command with `{issue}` replaced. */
export function issueView(issueNumber: string): string {
	return config.issueCommand.replaceAll("{issue}", issueNumber);
}

export function fetchIssueLabels(issueNumber: string): Array<string> {
	try {
		const output = io
			.execSync(`${issueView(issueNumber)} --json labels`, {
				cwd: repoRoot,
				encoding: "utf-8",
			})
			.toString();
		const payload = JSON.parse(output) as { labels?: Array<{ name?: string }> };
		return (payload.labels ?? []).map((label) => label.name ?? "").filter(Boolean);
	} catch {
		return [];
	}
}

/*
 * ---------------------------------------------------------------------------
 * Single issue runner (with resume support)
 * ---------------------------------------------------------------------------
 */

async function createIssueSandbox(
	branchName: string,
	suppliedWorktree: undefined | { branch: string; path: string },
	baseRef: string | undefined,
): Promise<{
	close: () => Promise<void>;
	run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
	worktreePath: string;
}> {
	if (suppliedWorktree !== undefined) {
		return {
			close: async () => undefined,
			run: async (runOptions: SandboxRunOptions) =>
				io.run({
					...runOptions,
					branchStrategy: { type: "head" },
					cwd: suppliedWorktree.path,
					sandbox: sandboxProvider,
				}),
			worktreePath: suppliedWorktree.path,
		};
	}

	return createPersistentSandbox(branchName, baseRef);
}

function printPhaseEvaluation(eval_: {
	design: PhaseDecision;
	implement: PhaseDecision;
	reasons: Record<PhaseName, string>;
	review: PhaseDecision;
}): void {
	console.log("\n── Phase evaluation ──");
	for (const phase of ["design", "implement", "review"] as Array<PhaseName>) {
		const decision = eval_[phase];
		const icon = decision === "skip" ? "⏭" : decision === "force" ? "🔄" : "▶";
		console.log(`  ${icon} ${phase}: ${decision.toUpperCase()} — ${eval_.reasons[phase]}`);
	}
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
	agent: ReturnType<typeof createAgent>;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
	};
	sharedArgs: SharedPromptArgs;
	state: object & ReturnType<typeof readState>;
}): Promise<boolean> {
	console.log(`\n── Phase 1: Design (issue #${params.issueNumber}) ──`);

	const planResult = await runPhaseWithRetry(
		async () =>
			params.sandbox.run({
				agent: params.agent,
				completionSignal: params.sharedArgs.COMPLETION_SIGNAL,
				logging: { type: "file", path: params.logPath, verbose: true },
				maxIterations: 1,
				name: `designer #${params.issueNumber}`,
				promptArgs: {
					...params.sharedArgs,
					SKILLS: skillsForPrompt("design", params.issueLabels),
				},
				promptFile: config.prompts.plan,
			}),
		"design",
	);

	if (planResult.stdout.length === 0) {
		console.warn("  ⚠ Design phase produced no output.");
		updatePhase(params.state, "design", "failed", { error: "no output" });
		(params.state as { lastError?: string }).lastError = "Design phase produced no output";
		return false;
	}

	updatePhase(params.state, "design", "done");
	console.log("  ✓ Design phase complete.");
	return true;
}

async function runImplementPhase(params: {
	agent: ReturnType<typeof createAgent>;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	maxImplementIterations: number;
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
	};
	sharedArgs: SharedPromptArgs;
	state: object & ReturnType<typeof readState>;
}): Promise<void> {
	console.log(
		`\n── Phase 2: Implement (issue #${params.issueNumber}, max ${params.maxImplementIterations} iterations) ──`,
	);

	const implResult = await runPhaseWithRetry(
		async () =>
			params.sandbox.run({
				agent: params.agent,
				completionSignal: params.sharedArgs.COMPLETION_SIGNAL,
				logging: { type: "file", path: params.logPath, verbose: true },
				maxIterations: params.maxImplementIterations,
				name: `implementer #${params.issueNumber}`,
				promptArgs: {
					...params.sharedArgs,
					SKILLS: skillsForPrompt("implement", params.issueLabels),
				},
				promptFile: config.prompts.implement,
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
	agent: ReturnType<typeof createAgent>;
	evalReview: PhaseDecision;
	hasCommits: boolean;
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
	};
	sharedArgs: SharedPromptArgs;
	state: object & ReturnType<typeof readState>;
}): Promise<void> {
	if (params.hasCommits || params.evalReview === "force") {
		console.log(`\n── Phase 3: Review (issue #${params.issueNumber}) ──`);

		await runPhaseWithRetry(
			async () =>
				params.sandbox.run({
					agent: params.agent,
					completionSignal: params.sharedArgs.COMPLETION_SIGNAL,
					logging: { type: "file", path: params.logPath, verbose: true },
					maxIterations: 5,
					name: `reviewer #${params.issueNumber}`,
					promptArgs: {
						...params.sharedArgs,
						SKILLS: skillsForPrompt("review", params.issueLabels),
					},
					promptFile: config.prompts.review,
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

function createFreshPhaseEvaluation(): {
	design: PhaseDecision;
	implement: PhaseDecision;
	reasons: Record<PhaseName, string>;
	review: PhaseDecision;
} {
	return {
		design: "start",
		implement: "start",
		reasons: {
			design: "fresh run",
			implement: "fresh run",
			review: "fresh run",
		},
		review: "start",
	};
}

function createOrLoadIssueState(params: {
	branchName: string;
	effort: string;
	issueNumber: string;
	model: string;
	options?: {
		baseRef?: string;
	};
}): NonNullable<ReturnType<typeof readState>> {
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
	state: NonNullable<ReturnType<typeof readState>>;
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

function prepareIssueWorktree(worktreePath: string, ignoreSetup = false): void {
	console.log("\n── Setup ──");
	const setupCommand = config.setupCommands.join(" && ");
	try {
		if (setupCommand !== "") {
			io.execSync(setupCommand, { cwd: worktreePath, stdio: "inherit" });
		}

		linkSymlinks(worktreePath);
		console.log("  ✓ Setup complete.");
	} catch (err) {
		if (ignoreSetup) {
			console.warn(`  ⚠ Setup failed (continuing): ${String(err)}`);
			return;
		}

		throw err;
	}
}

async function executeIssuePhases(params: {
	agent: ReturnType<typeof createAgent>;
	eval_: {
		design: PhaseDecision;
		implement: PhaseDecision;
		review: PhaseDecision;
	};
	issueLabels: Array<string>;
	issueNumber: string;
	logPath: string;
	maxImplementIterations: number;
	options?: { baseRef?: string; phase?: PhaseName };
	sandbox: {
		run: (runOptions: SandboxRunOptions) => Promise<SandboxRunResult>;
		worktreePath: string;
	};
	sharedArgs: SharedPromptArgs;
	state: NonNullable<ReturnType<typeof readState>>;
}): Promise<void> {
	if (params.eval_.design !== "skip") {
		const designOk = await runDesignPhase({
			agent: params.agent,
			issueLabels: params.issueLabels,
			issueNumber: params.issueNumber,
			logPath: params.logPath,
			sandbox: params.sandbox,
			sharedArgs: params.sharedArgs,
			state: params.state,
		});
		if (!designOk) {
			return;
		}
	} else {
		console.log("\n── Phase 1: Design — SKIPPED ──");
	}

	if (params.eval_.implement !== "skip") {
		await runImplementPhase({
			agent: params.agent,
			issueLabels: params.issueLabels,
			issueNumber: params.issueNumber,
			logPath: params.logPath,
			maxImplementIterations: params.maxImplementIterations,
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

	if (params.eval_.review !== "skip") {
		await runReviewPhase({
			agent: params.agent,
			evalReview: params.eval_.review,
			hasCommits,
			issueLabels: params.issueLabels,
			issueNumber: params.issueNumber,
			logPath: params.logPath,
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
	eval_: { design: PhaseDecision; implement: PhaseDecision },
	state: NonNullable<ReturnType<typeof readState>>,
): PhaseName {
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
	maxImplementIterations: number,
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
		COMPLETION_SIGNAL: randomUUID(),
		ISSUE_NUMBER: issueNumber,
		ISSUE_TITLE: issueTitle,
		PLAN_PATH: planPath,
		READY_LABEL: config.labels.readyForAgent,
		SKILLS: skillsForPrompt("design", issueLabels),
	};
	const agent = createAgent(
		options?.agentBackend ?? "dirac",
		model,
		effort,
		sharedArgs.COMPLETION_SIGNAL,
	);

	const state = createOrLoadIssueState({
		branchName,
		effort,
		issueNumber,
		model,
		options,
	});
	syncIssueStateOnResume({ effort, model, options, resume, state });

	const sandbox = await createIssueSandbox(branchName, suppliedWorktree, options?.baseRef);
	try {
		if (eval_.design !== "skip" || eval_.implement !== "skip" || eval_.review !== "skip") {
			prepareIssueWorktree(sandbox.worktreePath, options?.ignoreSetup);
		}

		await executeIssuePhases({
			agent,
			eval_,
			issueLabels,
			issueNumber,
			logPath,
			maxImplementIterations,
			options,
			sandbox,
			sharedArgs,
			state,
		});
	} catch (err) {
		const activePhase = resolveActiveFailedPhase(eval_, state);
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
	maxImplementIterations: number,
	concurrency: number,
	ignoreSetup = false,
): Promise<void> {
	console.log("Planning: analysing open issues for dependencies...\n");

	const planResult = await io.run({
		agent: createAgent(agentBackend, model, effort),
		maxIterations: 1,
		name: "planner",
		output: Output.object({ schema: PlanSchema, tag: "plan" }),
		promptArgs: {
			BASE_REF: config.baseBranch,
			BRANCH: "",
			COMPLETION_SIGNAL: randomUUID(),
			ISSUE_NUMBER: "all",
			ISSUE_TITLE: "",
			PLAN_PATH: "",
			READY_LABEL: config.labels.readyForAgent,
			SKILLS: skillsForPrompt("design"),
		},
		promptFile: config.prompts.planAll,
		sandbox: sandboxProvider,
	});

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
					await runSingleIssue(issue.id, model, effort, maxImplementIterations, {
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

/*
 * ---------------------------------------------------------------------------
 * Sequential issue workflow (with blocking detection)
 * ---------------------------------------------------------------------------
 */

/**
 * Checks if a review ended with "blocked" status by looking at review comments. Returns true if the
 * issue review concluded with "blocked" status.
 */
export function isIssueComplete(issueNumber: string): boolean {
	const state = readState(issueNumber);
	return (
		state?.phases.design.status === "done" &&
		state.phases.implement.status === "done" &&
		state.phases.review.status === "done" &&
		((state.phases.implement.extra?.["commits"] as undefined | Array<string>)?.length ?? 0) > 0
	);
}

type ReviewMarker = "BLOCKED" | "APPROVED";

export function getLatestReviewMarker(issueNumber: string): undefined | ReviewMarker {
	const output = io
		.execSync(`${issueView(issueNumber)} --json comments`, {
			cwd: repoRoot,
			encoding: "utf-8",
		})
		.toString();
	const data = JSON.parse(output) as { comments?: Array<{ body?: string }> };
	const markers: Array<ReviewMarker> = (data.comments ?? []).flatMap((comment) => {
		const markerPattern = new RegExp(
			`^\\s*${escapeRegExp(config.reviewMarker)}\\s*:\\s*(APPROVED|BLOCKED)\\s*$`,
			"gim",
		);
		const matches = [...(comment.body ?? "").matchAll(markerPattern)];
		return matches.flatMap((match) => {
			const marker = match[1]?.toUpperCase();
			return marker === "APPROVED" || marker === "BLOCKED" ? [marker] : [];
		});
	});
	return markers.at(-1);
}

export function isIssueBlocked(issueNumber: string): boolean {
	return getLatestReviewMarker(issueNumber) === "BLOCKED";
}

/**
 * Runs a sequence of issues serially, composing changes from each into the next. Automatically
 * aborts if any issue concludes with "blocked" status.
 */
/**
 * Runs multiple issues sequentially, chaining each completed branch as the next base.
 *
 * @rejects {Error} When sequential issue processing fails or is blocked.
 */
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

/*
 * ---------------------------------------------------------------------------
 * Integration composition
 * ---------------------------------------------------------------------------
 */

const integrationReviewStatuses: ReadonlySet<IntegrationStatus> = new Set([
	"ready-for-human-merge",
	"review-passed",
]);

export function resolveIssueIntegrationSource(
	issueNumber: string,
	allowUnreviewed: boolean,
): IntegrationSource {
	if (!/^\d+$/.test(issueNumber)) {
		throw new Error(`Invalid issue number ${JSON.stringify(issueNumber)}; expected digits.`);
	}

	const branch = `sandcastle/issue-${issueNumber}`;
	const state = readState(issueNumber);
	if (!allowUnreviewed && state?.phases.review.status !== "done") {
		throw new Error(
			`Cannot integrate issue #${issueNumber}: its review phase is not complete. Use --allow-unreviewed to override.`,
		);
	}

	if (!allowUnreviewed) {
		const marker = getLatestReviewMarker(issueNumber);
		if (marker !== "APPROVED") {
			throw new Error(
				`Cannot integrate issue #${issueNumber}: latest review marker is ${marker ?? "missing"}; expected APPROVED.`,
			);
		}
	}

	const commit = resolveCommit(branch);
	return { branch, commit, issue: issueNumber, name: `issue-${issueNumber}`, order: 0 };
}

export function resolveExistingIntegrationSource(
	name: string,
	allowUnreviewed: boolean,
): IntegrationSource {
	assertIntegrationName(name);
	const source = readIntegrationManifest(name);
	if (!source) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	if (!allowUnreviewed && !integrationReviewStatuses.has(source.status)) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: status is ${source.status}. Use --allow-unreviewed to override.`,
		);
	}

	if (
		source.headCommit !== undefined &&
		source.headCommit !== "" &&
		!commitExists(source.headCommit)
	) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: recorded commit ${source.headCommit} no longer exists.`,
		);
	}

	const currentCommit = resolveCommit(source.branch);
	if (
		source.headCommit !== undefined &&
		source.headCommit !== "" &&
		currentCommit !== source.headCommit
	) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: branch moved since its manifest was recorded.`,
		);
	}

	if (!commitExists(currentCommit)) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: branch commit ${currentCommit} no longer exists.`,
		);
	}

	return { branch: source.branch, commit: currentCommit, name, order: 0 };
}

export function createIntegrationManifest(
	name: string,
	kind: IntegrationKind,
	baseRef: string,
	sources: Array<IntegrationSource>,
	allowUnreviewed: boolean,
): IntegrationManifest {
	assertIntegrationName(name);
	if (readIntegrationManifest(name)) {
		throw new Error(
			`Integration ${JSON.stringify(name)} already exists; use integration-resume or choose another name.`,
		);
	}

	const now = new Date().toISOString();
	const manifest: IntegrationManifest = {
		allowUnreviewed: allowUnreviewed || undefined,
		base: { commit: "", ref: baseRef },
		branch: integrationBranch(name),
		createdAt: now,
		kind,
		name,
		sources: sources.map((source, index) => ({ ...source, order: index + 1 })),
		status: "created",
		updatedAt: now,
		worktree: `${config.dir}/integrations/${name}/worktree`,
	};

	try {
		manifest.base.commit = resolveCommit(baseRef);
		if (
			gitTry(["show-ref", "--verify", "--quiet", `refs/heads/${manifest.branch}`]) !==
			undefined
		) {
			throw new Error(`Branch ${manifest.branch} already exists.`);
		}

		if (existsSync(integrationBasePath(manifest))) {
			throw new Error(`Worktree path already exists: ${integrationBasePath(manifest)}`);
		}

		writeIntegrationManifest(manifest);
		mkdirSync(dirname(integrationBasePath(manifest)), { recursive: true });
		git([
			"worktree",
			"add",
			"-b",
			manifest.branch,
			integrationBasePath(manifest),
			manifest.base.commit,
		]);
	} catch (err) {
		manifest.status = "preflight-failed";
		manifest.lastError = String(err);
		writeIntegrationManifest(manifest);
		throw err;
	}

	return manifest;
}

export async function runConflictResolver(
	manifest: IntegrationManifest,
	source: IntegrationSource,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	const worktree = integrationBasePath(manifest);
	const completionSignal = randomUUID();
	const sourceContext = JSON.stringify(
		{
			base: manifest.base,
			integration: manifest.name,
			kind: manifest.kind,
			manifestPath: integrationManifestPath(manifest.name),
			source,
		},
		undefined,
		2,
	);
	await io.run({
		agent: createAgent(agentBackend, model, effort, completionSignal),
		branchStrategy: { type: "head" },
		completionSignal,
		cwd: worktree,
		logging: {
			type: "file",
			path: pathResolve(logsDir, `integration-${manifest.name}.log`),
			verbose: true,
		},
		maxIterations: 10,
		name: `resolve ${manifest.name} <- ${source.name}`,
		promptArgs: {
			COMPLETION_SIGNAL: completionSignal,
			INTEGRATION_NAME: manifest.name,
			SKILLS: "- resolving-merge-conflicts",
			SOURCE_CONTEXT: sourceContext,
			SOURCE_NAME: source.name,
		},
		promptFile: config.prompts.resolveConflicts,
		sandbox: sandboxProvider,
	});
}

export async function runIntegrationReview(
	manifest: IntegrationManifest,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	const completionSignal = randomUUID();
	const sourceContext = JSON.stringify(manifest.sources, undefined, 2);
	await io.run({
		agent: createAgent(agentBackend, model, effort, completionSignal),
		branchStrategy: { type: "head" },
		completionSignal,
		cwd: integrationBasePath(manifest),
		logging: {
			type: "file",
			path: pathResolve(logsDir, `integration-${manifest.name}.log`),
			verbose: true,
		},
		maxIterations: 5,
		name: `review integration ${manifest.name}`,
		promptArgs: {
			BASE_COMMIT: manifest.base.commit,
			BASE_REF: manifest.base.ref,
			BRANCH: manifest.branch,
			COMPLETION_SIGNAL: completionSignal,
			INTEGRATION_NAME: manifest.name,
			SKILLS: skillsForPrompt("review"),
			SOURCES: sourceContext,
		},
		promptFile: config.prompts.reviewIntegration,
		sandbox: sandboxProvider,
	});
}

export async function integrateManifestSource(
	manifest: IntegrationManifest,
	source: IntegrationSource,
	worktree: string,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	if (gitTry(["merge-base", "--is-ancestor", source.commit, "HEAD"], worktree) !== undefined) {
		return;
	}

	if (mergeInProgress(worktree)) {
		manifest.status = "conflict-resolution-required";
		manifest.lastError = `Conflict resolution is still required for ${source.name}.`;
		writeIntegrationManifest(manifest);
		await runConflictResolver(manifest, source, model, effort, agentBackend);
		assertCleanMergeResolution(manifest);
		return;
	}

	try {
		git(["merge", "--no-ff", source.commit, "-m", `Integrate ${source.name}`], worktree);
	} catch (err) {
		if (!hasUnmergedPaths(worktree)) {
			throw err;
		}

		manifest.status = "conflict-resolution-required";
		manifest.lastError = `Conflict while integrating ${source.name}: ${String(err)}`;
		writeIntegrationManifest(manifest);
		console.error(
			`  Conflict while integrating ${source.name}; invoking resolving-merge-conflicts.`,
		);
		await runConflictResolver(manifest, source, model, effort, agentBackend);
		assertCleanMergeResolution(manifest);
	}
}

export async function continueIntegration(
	manifest: IntegrationManifest,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	const worktree = integrationBasePath(manifest);
	if (!existsSync(worktree)) {
		throw new Error(`Integration worktree is missing: ${worktree}`);
	}

	try {
		manifest.status = "merging";
		manifest.lastError = undefined;
		writeIntegrationManifest(manifest);
		const start = manifest.currentSource ?? 0;

		for (let index = start; index < manifest.sources.length; index++) {
			const source = manifest.sources[index];
			if (source === undefined) {
				throw new Error(`Integration source at index ${index} is missing.`);
			}

			manifest.currentSource = index;
			writeIntegrationManifest(manifest);

			await integrateManifestSource(manifest, source, worktree, model, effort, agentBackend);

			if (
				gitTry(["merge-base", "--is-ancestor", source.commit, "HEAD"], worktree) ===
				undefined
			) {
				throw new Error(`Conflict resolver did not complete the merge for ${source.name}.`);
			}

			manifest.currentSource = index + 1;
			manifest.status = "merging";
			writeIntegrationManifest(manifest);
		}

		manifest.status = "integrated";
		writeIntegrationManifest(manifest);
		console.log(`  ✓ Merged ${manifest.sources.length} source(s) into ${manifest.branch}.`);

		manifest.status = "reviewing";
		writeIntegrationManifest(manifest);
		await runIntegrationReview(manifest, model, effort, agentBackend);
		assertCleanMergeResolution(manifest);
		if (git(["status", "--porcelain"], worktree).length > 0) {
			throw new Error(
				"Integration review left uncommitted changes; commit review corrections before handoff.",
			);
		}

		manifest.headCommit = resolveCommit(manifest.branch);
		manifest.status = "review-passed";
		writeIntegrationManifest(manifest);
		manifest.status = "ready-for-human-merge";
		writeIntegrationManifest(manifest);
		console.log("\nIntegration composition ready for human merge.");
		console.log(`\nBranch: ${manifest.branch}`);
		console.log(`Worktree: ${worktree}`);
	} catch (err) {
		if (manifest.status === "reviewing") {
			manifest.status = "review-failed";
		} else if (manifest.status === "merging") {
			manifest.status = "conflict-resolution-required";
		}

		manifest.lastError = String(err);
		writeIntegrationManifest(manifest);
		throw err;
	}
}

export async function runNewIntegration(
	kind: IntegrationKind,
	name: string,
	sourceNames: Array<string>,
	baseRef: string,
	allowUnreviewed: boolean,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	if (sourceNames.length === 0) {
		throw new Error("At least one integration source is required.");
	}

	const sourceResolver =
		kind === "issues" ? resolveIssueIntegrationSource : resolveExistingIntegrationSource;
	const sources = sourceNames.map((sourceName) => sourceResolver(sourceName, allowUnreviewed));
	const manifest = createIntegrationManifest(name, kind, baseRef, sources, allowUnreviewed);
	await continueIntegration(manifest, model, effort, agentBackend);
}

export async function resumeIntegration(
	name: string,
	model: string,
	effort: string,
	agentBackend: AgentBackend,
): Promise<void> {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	if (manifest.status === "ready-for-human-merge" || manifest.status === "aborted") {
		throw new Error(
			`Integration ${JSON.stringify(name)} cannot be resumed from status ${manifest.status}.`,
		);
	}

	await continueIntegration(manifest, model, effort, agentBackend);
}

export function printIntegrationStatus(name: string): void {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	const worktree = integrationBasePath(manifest);
	console.log(`\nIntegration: ${manifest.name}`);
	console.log(`Kind: ${manifest.kind}`);
	console.log(`Status: ${manifest.status}`);
	console.log(`Base: ${manifest.base.ref} (${manifest.base.commit || "unresolved"})`);
	console.log(`Branch: ${manifest.branch}`);
	console.log(`Worktree: ${worktree} (${existsSync(worktree) ? "exists" : "missing"})`);
	console.log(
		(() => {
			const sourceSummary =
				manifest.sources
					.map((source) => `${source.order}. ${source.name}@${source.commit}`)
					.join(", ") || "none";
			return `Sources: ${sourceSummary}`;
		})(),
	);
	if (existsSync(worktree)) {
		console.log(`Git: ${git(["status", "--short"], worktree) || "clean"}`);
	}

	if (manifest.lastError !== undefined && manifest.lastError !== "") {
		console.log(`Last error: ${manifest.lastError}`);
	}
}

export function abortIntegration(name: string): void {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	manifest.status = "aborted";
	manifest.lastError = "Aborted by operator; worktree was preserved for inspection.";
	writeIntegrationManifest(manifest);
	console.log(
		`Integration ${name} marked aborted. The worktree was preserved; use integration-cleanup when it is safe to remove.`,
	);
}

export function cleanupIntegration(name: string, force: boolean): void {
	assertIntegrationName(name);
	const manifest = readIntegrationManifest(name);
	if (manifest === undefined) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	const worktree = integrationBasePath(manifest);
	if (existsSync(worktree)) {
		if (
			!force &&
			(mergeInProgress(worktree) || git(["status", "--porcelain"], worktree).length > 0)
		) {
			throw new Error(
				"Worktree is dirty or has an active merge. Inspect it first or pass --force to cleanup.",
			);
		}

		git(["worktree", "remove", ...(force ? ["--force"] : []), worktree]);
	}

	manifest.status = "aborted";
	manifest.lastError = "Worktree cleaned up by operator; branch was preserved.";
	writeIntegrationManifest(manifest);
	console.log(`Cleaned up worktree for ${name}; branch ${manifest.branch} was preserved.`);
}

/*
 * ---------------------------------------------------------------------------
 * Main
 * ---------------------------------------------------------------------------
 */

let deprecationWarningsShown = false;

/**
 * Warns about legacy environment variables that moved into `sandcastle.config.ts`.
 * Only API keys (OPENAI_API_KEY, OPENAI_API_BASE, GH_TOKEN) remain environment-driven.
 */
function warnDeprecatedEnv(): void {
	if (deprecationWarningsShown) {
		return;
	}

	deprecationWarningsShown = true;
	const warnings: Array<string> = [];
	if (process.env["SANDCASTLE_AGENT"] !== undefined) {
		warnings.push("SANDCASTLE_AGENT is deprecated; set agents.default in sandcastle.config.ts");
	}
	if (process.env["SANDCASTLE_EFFORT"] !== undefined) {
		warnings.push("SANDCASTLE_EFFORT is deprecated; set effort in sandcastle.config.ts");
	}
	for (const key of ["DIRAC_SANDCASTLE_MODEL", "PI_SANDCASTLE_MODEL"] as const) {
		if (process.env[key] !== undefined) {
			const backend = key === "DIRAC_SANDCASTLE_MODEL" ? "dirac" : "pi";
			warnings.push(
				`${key} is deprecated; set agents.models.${backend} in sandcastle.config.ts`,
			);
		}
	}
	if (process.env["SANDCASTLE_MODEL"] !== undefined) {
		warnings.push(
			"SANDCASTLE_MODEL is not read; set agents.models.<backend> in sandcastle.config.ts",
		);
	}
	for (const warning of warnings) {
		console.warn(`  ⚠ ${warning}`);
	}
}

export async function main(): Promise<void> {
	warnDeprecatedEnv();
	const options = parseArgs(process.argv.slice(2));

	if (options.help) {
		printHelp();
		io.exit(0);
	}

	if (options.dryRun) {
		console.log(
			JSON.stringify(
				{
					agent: options.agentBackend,
					allowUnreviewed: options.allowUnreviewed,
					base: options.base,
					command: options.command,
					concurrency: options.concurrency,
					effort: options.effort,
					force: options.force === true ? "all" : (options.force ?? undefined),
					integrationName: options.integrationName ?? undefined,
					integrations: options.integrationNames,
					issueNumber: options.issueNumber || undefined,
					issues: options.issueNumbers,
					maxImplementIterations: options.maxImplementIterations,
					model: options.model,
					phase: options.phase ?? undefined,
					phases:
						options.command === "issue"
							? ["design", "implement", "review"]
							: ["preflight", "merge", "conflict-resolution", "review"],
					resume: options.resume,
					sandbox: "no-sandbox",
					worktree: options.worktree ?? undefined,
				},
				undefined,
				2,
			),
		);
		io.exit(0);
	}

	if (options.command === "issue") {
		if (!options.issueNumber) {
			printHelp();
			throw new Error("A numeric GitHub issue number (or 'all') is required.");
		}

		if (options.status) {
			printStatus(options.issueNumber, options.model, options.base, options.worktree);
			io.exit(0);
		}

		if (options.issueNumber === "all") {
			await runAll(
				options.model,
				options.agentBackend,
				options.effort,
				options.maxImplementIterations,
				options.concurrency,
				options.ignoreSetup,
			);
		} else {
			await runSingleIssue(
				options.issueNumber,
				options.model,
				options.effort,
				options.maxImplementIterations,
				{
					agentBackend: options.agentBackend,
					baseRef: options.base,
					force: options.force,
					ignoreSetup: options.ignoreSetup,
					phase: options.phase,
					resume: options.resume,
					worktree: options.worktree,
				},
			);
		}

		return;
	}

	if (options.command === "issue-sequence") {
		if (options.sequentialIssues.length === 0) {
			printHelp();
			throw new Error(
				"--sequential is required for issue-sequence command (comma-separated issue numbers)",
			);
		}

		await runSequentialIssues(
			options.sequentialIssues,
			options.base,
			options.model,
			options.effort,
			options.maxImplementIterations,
			options.agentBackend,
			options.resume,
			options.worktree,
			options.ignoreSetup,
		);
		return;
	}

	const name = options.integrationName;
	if (name === undefined || name === "") {
		throw new Error(`--name is required for ${options.command}.`);
	}

	switch (options.command) {
		case "integration-abort": {
			abortIntegration(name);

			break;
		}
		case "integration-cleanup": {
			cleanupIntegration(name, options.force === true);

			break;
		}
		case "integration-resume": {
			await resumeIntegration(name, options.model, options.effort, options.agentBackend);

			break;
		}
		case "integration-status": {
			printIntegrationStatus(name);

			break;
		}
		case "merge": {
			await runNewIntegration(
				"issues",
				name,
				options.issueNumbers,
				options.base,
				options.allowUnreviewed,
				options.model,
				options.effort,
				options.agentBackend,
			);

			break;
		}
		case "merge-integrations": {
			await runNewIntegration(
				"integrations",
				name,
				options.integrationNames,
				options.base,
				options.allowUnreviewed,
				options.model,
				options.effort,
				options.agentBackend,
			);

			break;
		}
		// No default
	}
}

function isDirectRun(): boolean {
	const entry = process.argv[1];
	if (entry === undefined || entry === "") {
		return false;
	}

	try {
		return (
			normalizedPath(realpathSync(entry)) === normalizedPath(realpathSync(mainModulePath))
		);
	} catch {
		return false;
	}
}

if (isDirectRun()) {
	main()
		.then(() => io.exit(0))
		.catch((err: unknown) => {
			console.error(err);
			io.exit(1);
		});
}

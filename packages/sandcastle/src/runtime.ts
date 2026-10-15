/*
 * Runtime context shared by every Sandcastle module.
 *
 * `repoRoot` is the process working directory — the checkout the caller stands in — while `stateRoot`
 * is the checkout that owns the runner's shared state, which differs only when the caller is inside
 * a linked worktree. The typed `sandcastle.config.ts` is loaded once here, from `repoRoot`. The `io`
 * object is the single injectable boundary tests stub out; production keeps the real Node and
 * sandcastle implementations.
 */

import {
	type AgentProvider,
	claudeCode,
	codex,
	copilot,
	cursor,
	opencode,
	pi,
	run,
} from "@ai-hero/sandcastle";

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";

const sandcastleDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = pathResolve(sandcastleDir, "..");
/** The repository the runner operates on; always the process working directory. */
export const repoRoot = process.cwd();
/**
 * Root of the runner's shared state.
 *
 * `repoRoot` is not it when the caller sits inside a linked worktree. An agent whose cwd is
 * `.sandcastle/worktrees/<branch>` would mint state there while the runner reads state from the
 * checkout that owns the run, so a marker the agent wrote would be invisible to the phase waiting
 * on it — which is exactly how a completion marker went missing. Only that case is redirected: a
 * run from the checkout itself, or from a subdirectory of it, keeps the caller's directory.
 */
export const stateRoot = sharedStateRoot(repoRoot);
export const config = loadConfig(repoRoot);
export const logsDir = pathResolve(stateRoot, config.dir, "logs");
export const plansDir = pathResolve(stateRoot, config.dir, "plans");
export const stateDir = pathResolve(stateRoot, config.dir, "state");
export const integrationsDir = pathResolve(stateRoot, config.dir, "integrations");
/**
 * Root of the persistent issue worktrees.
 *
 * Resolved against `stateRoot` like every other state path, not against `repoRoot`. A run started
 * inside a linked worktree would otherwise create and look for issue worktrees in a branch-local
 * `.sandcastle/worktrees`, while `queue clean` — which compares registered paths against this one —
 * would treat every worktree it found as foreign and silently keep all of them.
 */
export const worktreesDir = pathResolve(stateRoot, config.dir, "worktrees");
export const sandcastleEnvPath = pathResolve(repoRoot, config.dir, ".env");

/** Deterministic worktree path for a branch under the configured state dir. */
export function worktreePathForBranch(branch: string): string {
	return pathResolve(worktreesDir, branch.replace(/\//g, "-"));
}

/** `git rev-parse <args>` from `cwd`, or `undefined` when git cannot answer. */
function gitRevParse(args: ReadonlyArray<string>, cwd: string): string | undefined {
	try {
		const output = execFileSync("git", ["rev-parse", ...args], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return output === "" ? undefined : output;
	} catch {
		return undefined;
	}
}

/**
 * - The checkout that owns the runner's shared state.
 * - @param cwd - Directory to inspect.
 * - @returns `cwd`, unless it is a linked worktree, in which case the primary checkout.
 * - @remarks A linked worktree and its primary checkout share one `.git` common directory, and the
 *   worktree's own toplevel is not that directory's parent. Only that difference redirects, so a
 *   run from the checkout itself or from a subdirectory of it is unaffected.
 */
export function sharedStateRoot(cwd: string): string {
	const toplevel = gitRevParse(["--show-toplevel"], cwd);
	const common = gitRevParse(["--path-format=absolute", "--git-common-dir"], cwd);
	if (toplevel === undefined || common === undefined) {
		return cwd;
	}

	const primary = dirname(pathResolve(cwd, common));
	return normalizedPath(toplevel) === normalizedPath(primary) ? cwd : primary;
}

// Load Sandcastle configuration without replacing variables exported by the shell.
if (existsSync(sandcastleEnvPath)) {
	loadEnvFile(sandcastleEnvPath);
}

/**
 * Injectable I/O boundary so unit tests can stub git/gh/agents/exit without rewriting the runner.
 * Production keeps the real Node/sandcastle implementations.
 */
export const io = {
	claudeCode: ((...args: Parameters<typeof claudeCode>) => claudeCode(...args)) as (
		...args: Parameters<typeof claudeCode>
	) => AgentProvider,
	codex: ((...args: Parameters<typeof codex>) => codex(...args)) as (
		...args: Parameters<typeof codex>
	) => AgentProvider,
	copilot: ((...args: Parameters<typeof copilot>) => copilot(...args)) as (
		...args: Parameters<typeof copilot>
	) => AgentProvider,
	cursor: ((...args: Parameters<typeof cursor>) => cursor(...args)) as (
		...args: Parameters<typeof cursor>
	) => AgentProvider,
	execFileSync: ((...args: Parameters<typeof execFileSync>) =>
		execFileSync(...args)) as typeof execFileSync,
	execSync: ((...args: Parameters<typeof execSync>) => execSync(...args)) as typeof execSync,
	exit: (code: number): never => process.exit(code),
	opencode: ((...args: Parameters<typeof opencode>) => opencode(...args)) as (
		...args: Parameters<typeof opencode>
	) => AgentProvider,
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

/** Case-insensitive path comparison on Windows; exact elsewhere. */
export function normalizedPath(path: string): string {
	const resolved = pathResolve(path);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

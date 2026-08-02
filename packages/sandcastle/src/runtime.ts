/*
 * Runtime context shared by every Sandcastle module.
 *
 * The repository root is always the process working directory, and the typed
 * `sandcastle.config.ts` is loaded once here. The `io` object is the single
 * injectable boundary tests stub out; production keeps the real Node and
 * sandcastle implementations.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { type AgentProvider, pi, run } from "@ai-hero/sandcastle";

import { loadConfig } from "./config.js";

const sandcastleDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = pathResolve(sandcastleDir, "..");
/** The repository the runner operates on; always the process working directory. */
export const repoRoot = process.cwd();
export const config = loadConfig(repoRoot);
export const logsDir = pathResolve(repoRoot, config.dir, "logs");
export const plansDir = pathResolve(repoRoot, config.dir, "plans");
export const stateDir = pathResolve(repoRoot, config.dir, "state");
export const integrationsDir = pathResolve(repoRoot, config.dir, "integrations");
export const sandcastleEnvPath = pathResolve(repoRoot, config.dir, ".env");

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

/** Case-insensitive path comparison on Windows; exact elsewhere. */
export function normalizedPath(path: string): string {
	const resolved = pathResolve(path);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

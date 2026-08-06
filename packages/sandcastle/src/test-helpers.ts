/*
 * Shared helpers for the Sandcastle test suite.
 *
 * Every test file calls registerTestHooks() once at the top so io stubs,
 * process.argv, and the environment are reset between tests, then uses the
 * exported factories to write plans/state and stub git/gh/agent calls.
 */

/* oxlint-disable typescript/no-unnecessary-condition -- Tests intentionally inspect optional persisted state fields */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

import { io } from "./runtime.js";
import type { PhaseStatus } from "./types.js";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const tmpRoot = join(repositoryRoot, ".tmp", "sandcastle-tests");
export const plansDir = join(repositoryRoot, ".sandcastle", "plans");
export const stateDir = join(repositoryRoot, ".sandcastle", "state");
export const integrationsDir = join(repositoryRoot, ".sandcastle", "integrations");
export const markersDir = join(repositoryRoot, ".sandcastle", "markers");

const originalIo = {
	claudeCode: io.claudeCode,
	codex: io.codex,
	copilot: io.copilot,
	cursor: io.cursor,
	execFileSync: io.execFileSync,
	execSync: io.execSync,
	exit: io.exit,
	opencode: io.opencode,
	pi: io.pi,
	run: io.run,
	sleep: io.sleep,
};

const originalArgv = [...process.argv];
const originalEnv = { ...process.env };

export class ExitError extends Error {
	public readonly code: number;

	constructor(code: number) {
		super(`exit ${code}`);
		this.code = code;
	}
}

function restoreIo(): void {
	io.claudeCode = originalIo.claudeCode;
	io.codex = originalIo.codex;
	io.copilot = originalIo.copilot;
	io.cursor = originalIo.cursor;
	io.execFileSync = originalIo.execFileSync;
	io.execSync = originalIo.execSync;
	io.exit = originalIo.exit;
	io.opencode = originalIo.opencode;
	io.pi = originalIo.pi;
	io.run = originalIo.run;
	io.sleep = originalIo.sleep;
}

export function stubExit(): Array<number> {
	const codes: Array<number> = [];
	io.exit = (code: number) => {
		codes.push(code);
		throw new ExitError(code);
	};

	return codes;
}

export function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
	const keys = Object.keys(overrides);
	const previous = new Map(keys.map((key) => [key, process.env[key]]));
	try {
		for (const [key, value] of Object.entries(overrides)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}

		run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

export function uniqueIssue(prefix = "9"): string {
	return `${prefix}${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)
		.toString()
		.padStart(2, "0")}`;
}

export function cleanupIssueArtifacts(issue: string): void {
	const paths = [
		join(plansDir, `${issue}.md`),
		join(stateDir, `${issue}.json`),
		...["design", "implement", "review"].map((phase) =>
			join(markersDir, `${issue}.${phase}.completed`),
		),
	];
	for (const path of paths) {
		if (existsSync(path)) {
			rmSync(path, { force: true });
		}
	}
}

export function writePlan(issue: string, content: string): string {
	mkdirSync(plansDir, { recursive: true });
	const path = join(plansDir, `${issue}.md`);
	writeFileSync(path, content, "utf-8");
	return path;
}

export function makeState(
	issue: string,
	overrides: Partial<{
		commits: Array<string>;
		design: PhaseStatus;
		implement: PhaseStatus;
		model: string;
		review: PhaseStatus;
	}> = {},
): {
	branch: string;
	effort: "xhigh";
	issue: string;
	model: string;
	phases: {
		design: { status: PhaseStatus; timestamp: string };
		implement: { extra?: { commits: Array<string> }; status: PhaseStatus; timestamp: string };
		review: { status: PhaseStatus; timestamp: string };
	};
} {
	return {
		branch: `sandcastle/issue-${issue}`,
		effort: "xhigh",
		issue,
		model: overrides.model ?? "test-model",
		phases: {
			design: {
				status: overrides.design ?? "skipped",
				timestamp: "2026-01-01T00:00:00.000Z",
			},
			implement: {
				extra: overrides.commits ? { commits: overrides.commits } : undefined,
				status: overrides.implement ?? "skipped",
				timestamp: "2026-01-01T00:00:00.000Z",
			},
			review: {
				status: overrides.review ?? "skipped",
				timestamp: "2026-01-01T00:00:00.000Z",
			},
		},
	} as const;
}

export function stubExecSync(result: string): void {
	io.execSync = (() => result) as unknown as typeof io.execSync;
}

export function stubRun(result: Record<string, unknown>, markers: Array<string> = []): void {
	io.run = (async () => {
		for (const marker of markers) {
			mkdirSync(dirname(marker), { recursive: true });
			writeFileSync(marker, "", "utf-8");
		}

		return result;
	}) as unknown as typeof io.run;
}

export function gitStub(handlers: {
	file?: (args: ReadonlyArray<string>, cwd?: string) => string | undefined;
	sync?: (command: string, cwd?: string) => string | undefined;
}): void {
	io.execFileSync = ((
		command: string,
		args?: string | ReadonlyArray<string>,
		options?: {
			cwd?: string;
		},
	) => {
		if (command !== "git") {
			throw new Error(`unexpected execFileSync command: ${command}`);
		}

		const argv = Array.isArray(args) ? args.map(String) : [];
		const result = handlers.file?.(argv, options?.cwd);
		if (result === undefined) {
			throw new Error(`unhandled git ${argv.join(" ")}`);
		}

		return result;
	}) as typeof io.execFileSync;

	io.execSync = ((command: string, options?: { cwd?: string }) => {
		const result = handlers.sync?.(String(command), options?.cwd);
		if (result === undefined) {
			throw new Error(`unhandled execSync: ${command}`);
		}

		return result;
	}) as typeof io.execSync;
}

/** Resets io stubs, argv, and the environment before/after every test in the file. */
export function registerTestHooks(): void {
	beforeEach(() => {
		mkdirSync(tmpRoot, { recursive: true });
		restoreIo();
		process.argv = [...originalArgv];
	});

	afterEach(() => {
		restoreIo();
		process.argv = [...originalArgv];
		for (const [key, value] of Object.entries(originalEnv)) {
			process.env[key] = value;
		}

		for (const key of Object.keys(process.env)) {
			if (!(key in originalEnv)) {
				delete process.env[key];
			}
		}
	});
}

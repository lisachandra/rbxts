/*
 * Phase-scoped completion markers.
 *
 * Agents signal completion by creating a marker file as their final action.
 * Markers are scoped per run (issue phase, planner, integration step) and are
 * cleared before every run so stale files can never complete a later phase.
 */

import type { SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import { createAgent, scopeForMarkerPath } from "./agent.js";
import { completionRules } from "./prompts/completion.js";
import { config, stateRoot } from "./runtime.js";
import type { AgentBackend } from "./types.js";

export function markersDir(): string {
	return pathResolve(stateRoot, config.dir, "markers");
}

/** Absolute host path for a scoped completion marker, e.g. `<scope>.completed`. */
export function markerPath(scope: string): string {
	return pathResolve(markersDir(), `${scope}.completed`);
}

/** Create the markers directory and delete any stale marker at `path`. */
export function clearMarker(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	rmSync(path, { force: true });
}

export function markerExists(path: string): boolean {
	return existsSync(path);
}

/**
 * Prompt arguments a marker-backed phase needs: the completion block, marker path baked in.
 *
 * The path is interpolated here rather than left as a placeholder, so a nested substitution is
 * never what the agent ends up reading.
 */
export function completionPromptArgs(path: string): { COMPLETION: string } {
	return { COMPLETION: completionRules(path) };
}

/** Default phase budget: two hours, comfortably above a healthy implement phase. */
const DEFAULT_PHASE_BUDGET_MINUTES = 120;

/**
 * - Resolve the wall-clock budget for one phase attempt.
 * - @returns Budget in milliseconds; `0` disables the budget.
 */
export function resolvePhaseBudgetMs(): number {
	const raw = (process.env.SANDCASTLE_PHASE_BUDGET_MINUTES ?? "").trim();
	if (raw === "") {
		return DEFAULT_PHASE_BUDGET_MINUTES * 60_000;
	}

	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 0) {
		console.warn(
			`  ⚠ Invalid SANDCASTLE_PHASE_BUDGET_MINUTES "${raw}" — using the ${DEFAULT_PHASE_BUDGET_MINUTES} minute default.`,
		);
		return DEFAULT_PHASE_BUDGET_MINUTES * 60_000;
	}

	return parsed * 60_000;
}

/**
 * Thrown when a phase attempt exceeds its wall-clock budget.
 *
 * Upstream surfaces an abort reason verbatim (`signal.throwIfAborted()`), so this is both the
 * scheduled-abort reason and the error the retry loop sees. It is deliberately not a fatal provider
 * error: the whole point of the budget is to convert an unbounded stall into a bounded kill, and
 * the retry then resumes the captured agent session.
 */
export class PhaseBudgetError extends Error {
	override name = "PhaseBudgetError";

	constructor(minutes: number) {
		super(
			`Phase budget exceeded: killed after ${minutes} minutes with no completion marker. ` +
				"Raise it with SANDCASTLE_PHASE_BUDGET_MINUTES, or set it to 0 to disable.",
		);
	}
}

/**
 * Runs one marker-backed agent phase: clears the scoped marker, builds the agent, runs a single
 * iteration, and fails the phase if the marker is missing.
 *
 * The attempt runs under a wall-clock budget (`SANDCASTLE_PHASE_BUDGET_MINUTES`, default 120; 0
 * disables): on expiry upstream's abort signal kills the agent's whole process tree and this throws
 * {@link PhaseBudgetError}, which the retry loop treats as transient. Without it, an agent that
 * stays lively — polling a hung install, emitting wrapper keep-alives — never trips upstream's idle
 * watchdog and a phase can hang forever.
 *
 * @rejects {Error} When the phase finishes without a completion marker.
 * @rejects {PhaseBudgetError} When the attempt exceeds its wall-clock budget.
 */
export async function runMarkerPhase(params: {
	agentBackend: AgentBackend;
	effort: string;
	marker: string;
	model: string;
	name: string;
	promptArgs: NonNullable<SandboxRunOptions["promptArgs"]>;
	promptFile: string;
	run: (options: SandboxRunOptions) => Promise<SandboxRunResult>;
	runOptions?: Omit<
		SandboxRunOptions,
		"name" | "agent" | "promptArgs" | "promptFile" | "maxIterations"
	>;
}): Promise<SandboxRunResult> {
	clearMarker(params.marker);
	// The marker scope doubles as the session-store scope, keyed per issue+phase.
	const agent = createAgent(params.agentBackend, params.model, params.effort, params.marker, {
		scope: scopeForMarkerPath(params.marker),
	});

	const budgetMs = resolvePhaseBudgetMs();
	const controller = new AbortController();
	const budgetTimer =
		budgetMs > 0
			? setTimeout(() => {
					controller.abort(new PhaseBudgetError(budgetMs / 60_000));
				}, budgetMs)
			: undefined;
	budgetTimer?.unref?.();

	try {
		const result = await params.run({
			...params.runOptions,
			agent,
			maxIterations: 1,
			name: params.name,
			promptArgs: { ...params.promptArgs, ...completionPromptArgs(params.marker) },
			promptFile: params.promptFile,
			...(budgetMs > 0 ? { signal: controller.signal } : {}),
		});

		if (!markerExists(params.marker)) {
			throw new Error(`${params.name} finished without a completion marker.`);
		}

		return result;
	} finally {
		if (budgetTimer !== undefined) {
			clearTimeout(budgetTimer);
		}
	}
}

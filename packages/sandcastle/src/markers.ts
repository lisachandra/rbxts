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
import { CancelError, cancellation } from "./cancel.js";
import { assertWithin } from "./containment.js";
import { completionRules } from "./prompts/completion.js";
import { ConfigReloadError, resolveReloadCheckMs } from "./reload.js";
import { config, stateRoot } from "./runtime.js";
import type { AgentBackend } from "./types.js";

export function markersDir(): string {
	return pathResolve(stateRoot, config.dir, "markers");
}

/**
 * - Absolute host path for a scoped completion marker, e.g. `<scope>.completed`.
 * - @param scope - Run scope, e.g. `341.implement` or `integration-wave-1.resolve`.
 * - @returns The marker path under the markers directory.
 * - @throws {Error} When `scope` would place the marker outside the markers directory.
 * - @remarks The scope is built from an issue number or an integration name, and both can reach here
 *   as file content. `clearMarker` deletes the result, so a scope of `../../x` would delete a file
 *   outside the markers tree; the containment check is what makes the builder's own output the only
 *   thing that can be cleared.
 */
export function markerPath(scope: string): string {
	const directory = markersDir();
	return assertWithin(directory, pathResolve(directory, `${scope}.completed`), "marker");
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
	public override name = "PhaseBudgetError";

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
	/**
	 * Session-store scope, when it must differ from the marker's.
	 *
	 * Single-session mode points all three phases at one scope so each resumes the conversation the
	 * last one left behind. Split mode omits it, and the marker's own scope is used — which is what
	 * keeps resume per phase by default.
	 */
	sessionScope?: string;
	/**
	 * Live config watcher for this phase, when the run follows `sandcastle.config.ts`.
	 *
	 * Called on a tick and returns a description when this phase's selection moved, which aborts
	 * the attempt with {@link ConfigReloadError} so the retry loop restarts it on the new model.
	 * Omitted by callers with no config to follow, which keeps the pre-reload behavior exact.
	 */
	watchConfig?: () => string | undefined;
}): Promise<SandboxRunResult> {
	clearMarker(params.marker);
	// The marker scope doubles as the session-store scope, keyed per issue+phase.
	const agent = createAgent(params.agentBackend, params.model, params.effort, params.marker, {
		scope: params.sessionScope ?? scopeForMarkerPath(params.marker),
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

	/*
	 * The config watcher shares the attempt's abort controller with the budget and with operator
	 * cancellation, so an attempt has one way to end early and one error type per reason. The interval
	 * is deliberately not `unref`f: following the config is live work for as long as the attempt runs,
	 * unlike the budget's timer, which only has to fire once.
	 */
	const reloadTimer =
		params.watchConfig === undefined
			? undefined
			: setInterval(() => {
					const detail = params.watchConfig?.();
					if (detail !== undefined) {
						controller.abort(new ConfigReloadError(detail));
					}
				}, resolveReloadCheckMs());

	/*
	 * Operator cancellation has to reach the agent, not just the loop that would start the next
	 * phase: an in-flight attempt can run for the whole phase budget. The subscription is per
	 * attempt and removed in the `finally`, which is what keeps unlimited retries from accumulating
	 * listeners on the process-wide signal. The signal is captured because `reset` can replace it
	 * before the attempt finishes, and `removeEventListener` only works on the object that was
	 * subscribed.
	 */
	const { signal } = cancellation;
	const onCancel = (): void => {
		controller.abort(new CancelError());
	};

	if (signal.aborted) {
		onCancel();
	} else {
		signal.addEventListener("abort", onCancel, { once: true });
	}

	try {
		const result = await params.run({
			...params.runOptions,
			agent,
			maxIterations: 1,
			name: params.name,
			promptArgs: { ...params.promptArgs, ...completionPromptArgs(params.marker) },
			promptFile: params.promptFile,
			/*
			 * The signal is passed whenever either kill can fire. A phase with the budget disabled
			 * still has to be cancellable, so the condition is no longer "budget configured".
			 */
			signal: controller.signal,
		});

		if (!markerExists(params.marker)) {
			throw new Error(`${params.name} finished without a completion marker.`);
		}

		return result;
	} catch (err) {
		/*
		 * A kill can land after the agent has already written the marker: the abort fires upstream,
		 * which rethrows the reason verbatim and never reaches this function's own marker check, so
		 * the attempt's success was invisible. The marker is proof enough — it was cleared at the top
		 * of this attempt, so only this attempt can have written it, and the retry that would
		 * otherwise consume the error deletes it as its first act, destroying the evidence and
		 * re-running a phase that had already finished. The commits field is the only result any
		 * caller reads; upstream collects commits after the abort, so an empty list is the honest
		 * value and the implement caller unions it with the attempts it has already recorded.
		 */
		if (markerExists(params.marker)) {
			console.warn(
				`  ⚠ ${params.name} ${err instanceof PhaseBudgetError ? "hit the phase budget" : "failed"}, ` +
					"but the completion marker exists — treating the attempt as complete.",
			);
			return { commits: [], iterations: [], stdout: "" };
		}

		throw err;
	} finally {
		if (budgetTimer !== undefined) {
			clearTimeout(budgetTimer);
		}

		if (reloadTimer !== undefined) {
			clearInterval(reloadTimer);
		}

		signal.removeEventListener("abort", onCancel);
	}
}

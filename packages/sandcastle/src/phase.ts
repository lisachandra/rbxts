/*
 * The phase contract: one marker-backed agent attempt, start to finish.
 *
 * Every agent step the runner performs is the same stack — clear the scoped completion marker, build
 * the agent, run one attempt inside a worktree with file logging that also carries the session id,
 * retry transient provider failures while resuming the captured session, and refuse to call the
 * attempt finished unless the marker exists. That stack was hand-built five times: three issue
 * phases, the integration conflict resolver, and the integration review. This module owns it once.
 *
 * The attempt arrives as a *builder*, not as an object. `ConfigReloader.step("design")` and
 * `watchStep(reloader, "design")` have to be evaluated per attempt: a config reload aborts the
 * attempt, and the retry that follows must see the new selection with a watcher whose baseline is
 * that selection. Reading them once would freeze the model at the first attempt — the precise
 * failure the reload path exists to avoid.
 *
 * Deliberately not here: the planner. It runs with `Output.object`, which changes what the attempt
 * returns, so it is a different contract rather than a fifth caller of this one.
 */

import type { SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";

import { backendSupportsDigest, fileLogging } from "./logging.js";
import { runMarkerPhase } from "./markers.js";
import { saveSession } from "./providers/session-store.js";
import { runPhaseWithRetry } from "./retry.js";
import { runSessioned } from "./session-resume.js";
import type { ResolvedAgentStep } from "./types.js";

/** Everything one phase attempt needs that changes per attempt. */
export interface PhaseAttempt {
	/** Primary upstream log path; the digest lands beside it when the backend renders one. */
	logPath: string;
	/** Absolute path of the completion marker this attempt must create last. */
	marker: string;
	/**
	 * Agent display name, e.g. `designer #425`. Retry log lines use {@link runPhase}'s `label`, not
	 * this.
	 */
	name: string;
	/**
	 * Prompt arguments, without `COMPLETION`.
	 *
	 * The phase module adds the completion block itself, from {@link PhaseAttempt.marker}: the
	 * marker path and the instructions that name it are one fact, and splitting them across callers
	 * is how a phase ends up telling the agent to touch a file the runner is not watching.
	 */
	promptArgs: NonNullable<SandboxRunOptions["promptArgs"]>;
	/** Prompt file this attempt runs. */
	promptFile: string;
	/** The run function: `sandbox.run` for an issue phase, `io.run` for an integration one. */
	run: (options: SandboxRunOptions) => Promise<SandboxRunResult>;
	/** Session-store scope, e.g. `425.design` or `integration-wave-1.resolve`. */
	scope: string;
	/** Agent/model/effort for this attempt. */
	selection: ResolvedAgentStep;
	/**
	 * Session scope when it must differ from the marker's.
	 *
	 * Single-session mode points every phase of an issue at one scope so each resumes the
	 * conversation the last one left behind. Omitted, the marker-derived scope applies — which is
	 * what keeps resume per phase by default.
	 */
	sessionScope?: string;
	/**
	 * Live config watcher for this attempt, when the run follows `sandcastle.config.ts`.
	 *
	 * Called on a tick; returning a description aborts the attempt with `ConfigReloadError` so the
	 * retry restarts it on the new selection. Omitted by callers with no config to follow.
	 */
	watchConfig?: () => string | undefined;
}

/**
 * - Runs one phase attempt: marker, agent, session, logging, retry, marker assertion.
 * - @param label - Stable name for retry log lines, e.g. `design` or `resolve wave-1`.
 * - @param build - Builds the attempt. Invoked once per attempt, so a reload is honoured.
 * - @returns The sandbox run result, including `commits`, so a caller that needs them keeps them.
 * - @rejects {Error} Whatever the attempt throws once retries are exhausted or the error is fatal,
 *   and `CancelError` when the operator cancels.
 * - @remarks The order inside one attempt is load-bearing and is why this cannot be assembled by
 *   callers: `runSessioned` must wrap `runMarkerPhase` (the capture has to exist before
 *   `fileLogging` is built and the resumed id has to reach `runOptions`), and `runMarkerPhase` must
 *   wrap the run (it owns the marker clear, the budget, and the missing-marker failure). Only the
 *   innermost step differs between callers, and that is {@link PhaseAttempt.run}.
 */
export async function runPhase(
	label: string,
	build: () => PhaseAttempt,
): Promise<SandboxRunResult> {
	return runPhaseWithRetry(() => {
		const attempt = build();
		return runSessioned(
			{ backend: attempt.selection.agentBackend, scope: attempt.scope },
			({ capture, resumed }) =>
				runMarkerPhase({
					agentBackend: attempt.selection.agentBackend,
					effort: attempt.selection.effort,
					marker: attempt.marker,
					model: attempt.selection.model,
					name: attempt.name,
					promptArgs: attempt.promptArgs,
					promptFile: attempt.promptFile,
					run: attempt.run,
					runOptions: {
						...(resumed === undefined ? {} : { resumeSession: resumed.sessionId }),
						logging: fileLogging(attempt.logPath, {
							digest: backendSupportsDigest(attempt.selection.agentBackend),
							/*
							 * Write-through: a run killed externally never reaches the attempt-end
							 * persist in `runSessioned`, so the id must be durable the moment the
							 * stream announces it.
							 */
							onSessionCaptured: (sessionId) =>
								saveSession(attempt.scope, {
									backend: attempt.selection.agentBackend,
									sessionId,
								}),
							sessionCapture: capture,
						}),
					},
					...(attempt.sessionScope === undefined
						? {}
						: { sessionScope: attempt.sessionScope }),
					...(attempt.watchConfig === undefined
						? {}
						: { watchConfig: attempt.watchConfig }),
				}),
		);
	}, label);
}

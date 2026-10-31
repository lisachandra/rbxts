/*
 * Session-resume plumbing for phase runs.
 *
 * Each phase attempt is wrapped: before it runs, any session previously
 * captured for the phase scope is offered to upstream as `resumeSession`
 * (upstream gates it through the provider's `sessionStorage` precheck and
 * forwards it into `buildPrintCommand`); during the run, the raw stream is
 * fed through a `SessionCapture` (via `fileLogging`) so the id survives even
 * when the attempt fails — the failure case is exactly when resume matters.
 *
 * Resume is an optimization: the store is best-effort, `SANDCASTLE_NO_SESSION_RESUME=1`
 * opts out entirely, and a session the backend rejects (stale id) is cleared so
 * the next attempt starts fresh.
 */

import { createSessionCapture, type SessionCapture } from "./providers/session-capture.js";
import { clearSession, loadSession, saveSession } from "./providers/session-store.js";
import type { StoredSession } from "./providers/session-store.js";

/** Env flag that disables session resume (fresh sessions on every attempt). */
export function sessionResumeDisabled(): boolean {
	return process.env.SANDCASTLE_NO_SESSION_RESUME === "1";
}

/** What a caller must supply to run one phase attempt with resume support. */
export interface SessionedAttemptParams {
	/** Backend identifier recorded with the session id. */
	backend: string;
	/** A fresh capture per attempt; the wrapper reads the id from it afterwards. */
	prepare: (capture: SessionCapture) => void;
	/** Marker scope of the phase (e.g. `425.design`, `planner`). */
	scope: string;
}

/**
 * Result of {@link runSessioned}: the captured session (for tests) plus whether the attempt resumed
 * a previous session.
 */
export interface SessionedAttemptResult {
	/** The id captured from this attempt's stream, or `undefined` when none surfaced. */
	capturedSessionId: string | undefined;
	/** The session that was resumed, or `undefined` when the attempt started fresh. */
	resumedSession: undefined | StoredSession;
}

/**
 * - Read the stored session for a scope, unless resume is disabled or the stored backend differs from
 *   the one about to run.
 * - @param scope - Marker scope of the phase.
 * - @param backend - Backend identifier about to run.
 * - @returns The resumable session, or `undefined` to start fresh.
 */
export function resumableSession(scope: string, backend: string): undefined | StoredSession {
	if (sessionResumeDisabled()) {
		return undefined;
	}

	const stored = loadSession(scope);
	return stored !== undefined && stored.backend === backend ? stored : undefined;
}

/**
 * - Prepare a phase attempt: resolve the resumable session and hand a fresh capture to the caller so
 *   it can thread both into `fileLogging`/run options.
 * - @param params - Scope, backend, and a `prepare` callback receiving the capture.
 * - @returns The resumed session (when any) for logging and `runOptions`.
 */
export function beginSessionedAttempt(
	params: { backend: string; scope: string },
	prepare: (capture: SessionCapture) => void,
): undefined | StoredSession {
	const capture = createSessionCapture();
	prepare(capture);
	const resumed = resumableSession(params.scope, params.backend);
	if (resumed !== undefined) {
		console.log(
			`  ↩ Resuming ${params.backend} session ${resumed.sessionId} for ${params.scope}`,
		);
	}

	return resumed;
}

/**
 * Run one phase attempt with session capture and resume wired around it.
 *
 * @remarks
 *   Captured ids persist on both success and failure — the failure case is exactly when resume
 *   matters. For durability against an externally killed process (which never reaches the
 *   attempt-end persist), call sites also pass `onSessionCaptured` into `fileLogging` and save the
 *   id write-through the moment the stream announces it.
 * @param params - Scope and backend of the phase.
 * @param attempt - Invoked once with the capture (thread it into `fileLogging`'s `sessionCapture`)
 *   and the resumable session (thread its id into `runOptions.resumeSession`); its promise is the
 *   attempt's result.
 * @returns The attempt's result.
 * @rejects {Error} Whatever `attempt` rejects with, after persisting (or clearing) the captured
 *   session state.
 */
export async function runSessioned<T>(
	params: { backend: string; scope: string },
	attempt: (args: { capture: SessionCapture; resumed: undefined | StoredSession }) => Promise<T>,
): Promise<T> {
	let capture: undefined | SessionCapture;
	let failed = false;
	const resumed = beginSessionedAttempt(params, (resolvedCapture) => {
		capture = resolvedCapture;
	});

	try {
		return await attempt({ capture: capture!, resumed });
	} catch (err) {
		failed = true;
		endSessionedAttempt(params.scope, params.backend, capture!, resumed, err);
		throw err;
	} finally {
		// The catch path already ended the attempt with the error.
		if (!failed) {
			endSessionedAttempt(params.scope, params.backend, capture!, resumed);
		}
	}
}

/**
 * - Finish a phase attempt: persist the captured session, or clear the store when the attempt resumed
 *   a session that no longer exists upstream.
 * - @param scope - Marker scope of the phase.
 * - @param backend - Backend identifier that ran.
 * - @param capture - The attempt's capture (may hold the new session id).
 * - @param resumed - The session this attempt resumed, if any.
 * - @param error - The attempt's failure, when it failed.
 * - @remarks Double-invocation safe: {@link runSessioned} calls this in the error path and again in
 *   `finally`; a second call without a new captured id is a no-op for the store.
 */
export function endSessionedAttempt(
	scope: string,
	backend: string,
	capture: SessionCapture,
	resumed: undefined | StoredSession,
	error?: unknown,
): SessionedAttemptResult {
	const capturedSessionId = capture.sessionId();
	if (capturedSessionId === undefined) {
		/*
		 * No session surfaced: when the attempt resumed an id the backend no longer
		 * knows (pruned store, wrong worktree), drop it so the next attempt starts
		 * fresh instead of failing the same way forever.
		 */
		if (resumed !== undefined && error !== undefined && isStaleSessionError(error)) {
			clearSession(scope);
		}

		return { capturedSessionId, resumedSession: resumed };
	}

	saveSession(scope, { backend, sessionId: capturedSessionId });
	return { capturedSessionId, resumedSession: resumed };
}

/**
 * Whether an error means the resumed session id was rejected (dirac prints "Task not found: <id>";
 * zcode's session/resume fails on unknown sessions, and its schema rejects malformed resume params
 * — e.g. an unexpected root key — with "Invalid params — (root): Unrecognized key: ...").
 */
export function isStaleSessionError(err: unknown): boolean {
	const message = String(err).toLowerCase();
	return /task not found|session not found|unknown session|no such session|invalid params|unrecognized key/.test(
		message,
	);
}

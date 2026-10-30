/*
 * Persisted agent session ids per phase scope.
 *
 * A phase that dies mid-run loses its agent conversation unless the next
 * attempt knows the session id. The store is a single JSON file per scope
 * (marker scope: `425.design`, `planner`, `integration-<name>`) holding the
 * last captured `{ backend, sessionId }`. Resume is an optimization, never a
 * hard dependency: every failure to read or write degrades to "start fresh".
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import { config, stateRoot } from "../runtime.js";

/** A captured agent session for one phase scope. */
export interface StoredSession {
	backend: string;
	sessionId: string;
	updatedAt: string;
}

/** Root directory of the session store: `<stateRoot>/<config.dir>/sessions`. */
export function sessionsDir(): string {
	return pathResolve(stateRoot, config.dir, "sessions");
}

/** Absolute path of the store file for a scope. */
export function sessionFilePath(scope: string): string {
	/*
	 * Scopes may carry path separators (e.g. an integration name with a slash);
	 * flatten them so each scope is exactly one file.
	 */
	return pathResolve(sessionsDir(), `${scope.replaceAll(/[\\/]/g, "-")}.json`);
}

/**
 * - Persist the session captured from a phase attempt.
 * - @param scope - Marker scope of the phase (e.g. `425.design`).
 * - @param session - Backend and session id to store; `sessionId` must be set.
 */
export function saveSession(scope: string, session: { backend: string; sessionId: string }): void {
	if (session.sessionId === "") {
		return;
	}

	try {
		const path = sessionFilePath(scope);
		mkdirSync(dirname(path), { recursive: true });
		const stored: StoredSession = {
			backend: session.backend,
			sessionId: session.sessionId,
			updatedAt: new Date().toISOString(),
		};
		writeFileSync(path, `${JSON.stringify(stored, null, "\t")}\n`, "utf-8");
	} catch (err) {
		console.warn(`  ⚠ Could not save the agent session for ${scope}: ${String(err)}`);
	}
}

/**
 * - Read the session stored for a scope.
 * - @param scope - Marker scope of the phase.
 * - @returns The stored session, or `undefined` when absent, unreadable, or malformed.
 */
export function loadSession(scope: string): undefined | StoredSession {
	const path = sessionFilePath(scope);
	if (!existsSync(path)) {
		return undefined;
	}

	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as StoredSession).backend === "string" &&
			typeof (parsed as StoredSession).sessionId === "string" &&
			(parsed as StoredSession).sessionId !== ""
		) {
			return parsed as StoredSession;
		}
	} catch {
		// Corrupt store: fall through to "no session".
	}

	return undefined;
}

/**
 * - Drop the stored session for a scope (e.g. the CLI rejected it as stale).
 * - @param scope - Marker scope of the phase.
 */
export function clearSession(scope: string): void {
	try {
		rmSync(sessionFilePath(scope), { force: true });
	} catch {
		// Best-effort: a lingering file only means one wasted resume attempt.
	}
}

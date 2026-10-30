/*
 * Provider-side session storage for the resume precheck.
 *
 * Upstream `@ai-hero/sandcastle` gates `resumeSession` on
 * `provider.sessionStorage.findByIdOnHost(id)` (no-sandbox runs) or
 * `existsOnHost(cwd, id)` (sandboxed runs). Dirac and zcode own their session
 * stores natively — dirac keys tasks in `~/.dirac/data/state/taskHistory.json`
 * and zcode persists sessions in its own store — so sandcastle does not copy
 * session files; it only remembers the id it saw. The store lookup therefore
 * consults sandcastle's per-scope session store and reports where it looked.
 */

import type { HostSessionLookup } from "@ai-hero/sandcastle";

import { loadSession, sessionFilePath } from "./session-store.js";

/**
 * Upstream's `AgentSessionStorage` capability. It is not exported from `@ai-hero/sandcastle`, so
 * mirror the members upstream actually calls: the no-sandbox precheck uses `findByIdOnHost`,
 * sandboxed runs use `existsOnHost`/`hostSessionFilePath`, and the transfer hooks are only invoked
 * when `captureSessions` is true (never for dirac/zcode).
 */
export interface SandcastleAgentSessionStorage {
	captureToHost(args: {
		handle: unknown;
		hostCwd: string;
		sandboxCwd: string;
		sessionId: string;
	}): Promise<void>;
	existsOnHost(cwd: string, sessionId: string): Promise<boolean>;
	findByIdOnHost(sessionId: string): Promise<HostSessionLookup>;
	hostSessionFilePath(cwd: string, sessionId: string): string | undefined;
	readHostSession(cwd: string, sessionId: string): Promise<string | undefined>;
	resumeIntoSandbox(args: {
		handle: unknown;
		hostCwd: string;
		sandboxCwd: string;
		sessionId: string;
	}): Promise<void>;
}

/**
 * - Build the capability object upstream's resume gate requires.
 * - @param scope - Marker scope the provider's runs are persisted under (e.g. `425.design`).
 * - @param backend - Backend name recorded alongside the session id.
 * - @returns A session-storage capability backed by sandcastle's own session store.
 */
export function sandcastleSessionStorage(
	scope: string,
	backend: string,
): SandcastleAgentSessionStorage {
	const searchedRoot = sessionFilePath(scope);

	return {
		/*
		 * Session transfer only matters for sandboxed providers that copy JSONL
		 * files around; dirac and zcode run no-sandbox and keep their own stores,
		 * so these are never called (captureSessions is false).
		 */
		captureToHost: async () => undefined,
		existsOnHost: async (_cwd: string, sessionId: string): Promise<boolean> =>
			loadSession(scope)?.sessionId === sessionId,
		findByIdOnHost: async (sessionId: string): Promise<HostSessionLookup> => {
			const stored = loadSession(scope);
			const path =
				stored !== undefined && stored.backend === backend && stored.sessionId === sessionId
					? sessionFilePath(scope)
					: undefined;
			return { path, searchedRoot };
		},
		hostSessionFilePath: () => searchedRoot,
		readHostSession: async () => undefined,
		resumeIntoSandbox: async () => undefined,
	};
}

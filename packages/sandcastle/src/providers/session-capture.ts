/*
 * Agent session-id capture from raw provider stdout.
 *
 * Every resumable backend announces its session id on an early JSONL line, and each shape is that
 * CLI's own: dirac emits `{"type":"task_started","taskId"}`, the zcode wrapper emits
 * `{"type":"session_id","sessionId"}`, pi emits `{"type":"session","id"}`, codex emits
 * `{"type":"thread.started","thread_id"}`, and claude-code emits
 * `{"type":"system","subtype":"init","session_id"}`. The capture consumes the same raw stream
 * upstream feeds to the digest (`onAgentStreamEvent`), so the id is recorded even when the run later
 * fails — exactly the case resume exists for. Parsing stays stream-local: callers own where the id is
 * persisted.
 *
 * The backends that cannot resume are deliberately absent. Recording their id would put a value in
 * the store that upstream's precheck then refuses outright (`<name> does not support resumeSession`),
 * which turns the fresh start those backends rely on into a hard failure.
 */

import { isValidSessionId } from "../child-process.js";

/** Parses a resumable backend's stdout lines and remembers the announced session id. */
export interface SessionCapture {
	/** Feed one raw stdout line; JSONL lines that announce a session id update the capture. */
	onStreamLine(line: string): void;
	/** The captured session id, or `undefined` until a line announces one. */
	sessionId(): string | undefined;
}

/** A dirac `task_started` line. */
interface DiracTaskStarted {
	type?: unknown;
	taskId?: unknown;
}

/** A zcode wrapper `session_id` line. */
interface ZcodeSessionId {
	type?: unknown;
	sessionId?: unknown;
}

/** A pi `session` line. */
interface PiSession {
	type?: unknown;
	id?: unknown;
}

/** A codex `thread.started` line. */
interface CodexThreadStarted {
	type?: unknown;
	thread_id?: unknown;
}

/** A claude-code `system`/`init` line. */
interface ClaudeCodeInit {
	type?: unknown;
	session_id?: unknown;
	subtype?: unknown;
}

/** Type guard for the dirac task_started shape. */
function isDiracTaskStarted(value: unknown): value is DiracTaskStarted {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as DiracTaskStarted;
	return record.type === "task_started" && typeof record.taskId === "string";
}

/** Type guard for the zcode session_id shape. */
function isZcodeSessionId(value: unknown): value is ZcodeSessionId {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as ZcodeSessionId;
	return record.type === "session_id" && typeof record.sessionId === "string";
}

/** Type guard for the pi session shape. */
function isPiSession(value: unknown): value is PiSession {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as PiSession;
	return record.type === "session" && typeof record.id === "string";
}

/** Type guard for the codex thread.started shape. */
function isCodexThreadStarted(value: unknown): value is CodexThreadStarted {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as CodexThreadStarted;
	return record.type === "thread.started" && typeof record.thread_id === "string";
}

/** Type guard for the claude-code system/init shape. */
function isClaudeCodeInit(value: unknown): value is ClaudeCodeInit {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as ClaudeCodeInit;
	return (
		record.type === "system" &&
		record.subtype === "init" &&
		typeof record.session_id === "string"
	);
}

/** Every announcement shape, paired with how to read its id. */
const SESSION_ANNOUNCEMENTS: ReadonlyArray<{
	id: (value: never) => unknown;
	is: (value: unknown) => boolean;
}> = [
	{ id: (value: DiracTaskStarted) => value.taskId, is: isDiracTaskStarted },
	{ id: (value: ZcodeSessionId) => value.sessionId, is: isZcodeSessionId },
	{ id: (value: PiSession) => value.id, is: isPiSession },
	{ id: (value: CodexThreadStarted) => value.thread_id, is: isCodexThreadStarted },
	{ id: (value: ClaudeCodeInit) => value.session_id, is: isClaudeCodeInit },
];

/**
 * - Create a capture for one phase attempt.
 * - @returns The capture; feed it every raw line, then read `sessionId()`.
 */
export function createSessionCapture(): SessionCapture {
	let captured: string | undefined;

	return {
		onStreamLine(line: string): void {
			const trimmed = line.trim();
			if (trimmed === "" || !trimmed.startsWith("{")) {
				return;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(trimmed);
			} catch {
				return;
			}

			for (const announcement of SESSION_ANNOUNCEMENTS) {
				if (!announcement.is(parsed)) {
					continue;
				}

				const id = announcement.id(parsed as never);
				/*
				 * Rejected rather than laundered: the id came from the agent's own stdout, so a value
				 * that is not a token is a value a hostile or broken agent chose. Dropping it means the
				 * next attempt starts a fresh session instead of replaying an attacker-shaped argument.
				 */
				if (typeof id === "string" && isValidSessionId(id)) {
					captured = id;
				}

				return;
			}
		},
		sessionId(): string | undefined {
			return captured;
		},
	};
}

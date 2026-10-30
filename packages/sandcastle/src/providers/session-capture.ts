/*
 * Agent session-id capture from raw provider stdout.
 *
 * Both resumable backends announce their session id as an early JSONL line:
 * dirac emits `{"type":"task_started","taskId"}` and the zcode wrapper emits
 * `{"type":"session_id","sessionId"}`. The capture consumes the same raw
 * stream upstream feeds to the digest (`onAgentStreamEvent`), so the id is
 * recorded even when the run later fails — exactly the case resume exists
 * for. Parsing stays stream-local: callers own where the id is persisted.
 */

/** Parses dirac/zcode stdout lines and remembers the announced session id. */
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

			if (isDiracTaskStarted(parsed)) {
				captured = parsed.taskId as string;
				return;
			}

			if (isZcodeSessionId(parsed)) {
				captured = parsed.sessionId as string;
			}
		},
		sessionId(): string | undefined {
			return captured;
		},
	};
}

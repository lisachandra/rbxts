/*
 * Agent log helpers.
 *
 * `.log` files are upstream `@ai-hero/sandcastle` file-mode logs verbatim
 * (`FileDisplay` output with `verbose: true`, so raw agent stdout JSONL is
 * interleaved) — the same behavior as before the three-file split.
 *
 * For runs whose backend renders a digest (dirac, zcode), `fileLogging`
 * additionally streams a clean markdown digest into `<name>.digest.log` as
 * agent events arrive, so the readable output is visible while the run is
 * still in flight and survives failures.
 */

import type { AgentStreamEvent, LoggingOption } from "@ai-hero/sandcastle";

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import type { SessionCapture } from "./providers/session-capture.js";

/** Backends whose stream renderer is supported by the readable digest. */
const DIGEST_BACKENDS: ReadonlySet<string> = new Set(["dirac", "zcode"]);

/**
 * Whether a backend's stream should be rendered into the readable digest.
 *
 * - @param backend - Agent backend identifier.
 * - @returns True when `fileLogging` should stream `<name>.digest.log`.
 */
export function backendSupportsDigest(backend: string | undefined): boolean {
	return backend !== undefined && DIGEST_BACKENDS.has(backend);
}

/**
 * Digest file path for a digest-enabled run. Strips a trailing `.log` so `issue-1.log` maps to
 * `issue-1.digest.log`.
 *
 * - @param logPath - Primary upstream log path.
 * - @returns Path of the markdown digest.
 */
export function digestPath(logPath: string): string {
	return logPath.endsWith(".log")
		? `${logPath.slice(0, -".log".length)}.digest.log`
		: `${logPath}.digest.log`;
}

/**
 * Formats a `Run started` marker with both UTC (machine-sortable) and local wall-clock time.
 *
 * `Date.toISOString()` always emits UTC (trailing `Z`), so on a GMT+7 machine `00:00Z` reads as 7h
 * behind the wall clock. Appending the local rendering keeps the UTC timestamp for sorting while
 * showing the time operators expect.
 *
 * - @param now - Timestamp to format (defaults to now).
 * - @returns Marker body, e.g. `2026-09-06T00:00:00.000Z (local: 2026-09-06 07:00:00 GMT+07:00)`.
 */
export function formatRunStarted(now: Date = new Date()): string {
	const iso = now.toISOString();
	const pad = (value: number): string => String(value).padStart(2, "0");
	const offsetMinutes = -now.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absolute = Math.abs(offsetMinutes);
	const local =
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
		`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ` +
		`GMT${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
	return `${iso} (local: ${local})`;
}

/**
 * Builds file logging for an agent run.
 *
 * The primary log is plain upstream file-mode output (`verbose: true`, matching pre-split
 * behavior). When `digest` is set (digest-enabled backends), the digest file is created
 * synchronously with a header and `Run started` marker, and every subsequent `raw` stream event is
 * rendered to markdown and appended immediately — so the digest exists from run start even if the
 * run fails or is killed mid-flight. When `sessionCapture` is set, every raw stream line feeds the
 * capture so the agent's session id survives even a failed run — the failure case is exactly when
 * resume needs it. When `onSessionCaptured` is also set, it fires the moment the capture parses a
 * session id (write-through): a run killed externally never reaches the attempt-end persist, so the
 * id must be durable before the first turn completes.
 *
 * - @param logPath - Primary upstream log path.
 * - @param options - Set `digest: true` for digest-enabled backends to stream `<name>.digest.log`;
 *   pass `sessionCapture` to record the agent's session id from the raw stream; pass
 *   `onSessionCaptured` to persist the id as soon as it is parsed.
 * - @returns Logging options for the sandbox `run()` call.
 */
export function fileLogging(
	logPath: string,
	options?: {
		digest?: boolean;
		onSessionCaptured?: (sessionId: string) => void;
		sessionCapture?: SessionCapture;
	},
): LoggingOption {
	const digestFilePath = options?.digest === true ? digestPath(logPath) : undefined;
	const sessionCapture = options?.sessionCapture;
	const onSessionCaptured = options?.onSessionCaptured;
	if (digestFilePath !== undefined) {
		ensureLogDir(digestFilePath);
		try {
			if (!existsSync(digestFilePath)) {
				writeFileSync(
					digestFilePath,
					`# Readable agent log digest\n\n--- Run started: ${formatRunStarted()} ---\n`,
					"utf-8",
				);
			} else {
				appendFileSync(digestFilePath, `\n--- Run started: ${formatRunStarted()} ---\n`);
			}
		} catch {
			// Best-effort: digest capture must never break the run.
		}
	}

	let capturedNotified = false;
	const onAgentStreamEvent =
		digestFilePath === undefined && sessionCapture === undefined
			? undefined
			: (event: AgentStreamEvent): void => {
					if (event.type !== "raw") {
						return;
					}

					sessionCapture?.onStreamLine(event.line);
					if (onSessionCaptured !== undefined && !capturedNotified) {
						const sessionId = sessionCapture?.sessionId();
						if (sessionId !== undefined) {
							capturedNotified = true;
							try {
								onSessionCaptured(sessionId);
							} catch {
								// Best-effort: persistence must never break the run.
							}
						}
					}

					if (digestFilePath === undefined) {
						return;
					}

					const rendered = renderEventLine(event.line);
					if (rendered === undefined) {
						return;
					}

					const headerBlock =
						rendered.header === ""
							? ""
							: `${rendered.header}

`;
					const entry = `
---

${headerBlock}${rendered.body}
`;
					try {
						appendFileSync(digestFilePath, entry);
					} catch {
						// Best-effort: digest capture must never break the run.
					}
				};

	return {
		type: "file",
		...(onAgentStreamEvent !== undefined ? { onAgentStreamEvent } : {}),
		path: logPath,
		verbose: true,
	};
}

interface DigestEntry {
	body: string;
	header: string;
}

/**
 * Whether an assistant markdown chunk is a rules-context dump.
 *
 * Dirac emits `{"rules":[...]}` as assistant markdown when rules load, which is metadata rather
 * than prose. The dirac provider already drops it from the terminal stream, so the digest drops it
 * too instead of filling the log with one JSON blob per rule lookup.
 */
function isRulesDump(text: string): boolean {
	return text.trimStart().startsWith('{"rules"');
}

/**
 * Extracts a readable rendering from a single raw stream event line, or `undefined` when the line
 * carries nothing worth rendering (reasoning traces, rules-context dumps, token usage, control
 * events).
 */
function renderEventLine(line: string): undefined | DigestEntry {
	if (line.trim() === "") {
		return undefined;
	}

	let parsed: {
		content?: {
			card?: { body?: unknown; header?: unknown };
			content?: unknown;
			isReasoning?: unknown;
			role?: unknown;
			type?: unknown;
		};
		detail?: unknown;
		name?: unknown;
		state?: unknown;
		text?: unknown;
		type?: unknown;
	};
	try {
		parsed = JSON.parse(line) as typeof parsed;
	} catch {
		return undefined;
	}

	// zcode wrapper events: assistant text slices carry the readable payload.
	if (parsed.type === "text" && typeof parsed.text === "string" && parsed.text.trim() !== "") {
		return { body: parsed.text, header: "" };
	}

	// zcode wrapper tool events render like dirac's card headers: what ran, what came back.
	if (parsed.type === "tool" && typeof parsed.name === "string") {
		const state = typeof parsed.state === "string" ? parsed.state : "unknown";
		const detail = typeof parsed.detail === "string" ? parsed.detail.trim() : "";
		return {
			body: detail === "" ? `(${state})` : detail,
			header: `> ${parsed.name} (${state})`,
		};
	}

	const { content } = parsed;
	if (content === undefined) {
		return undefined;
	}

	// Assistant markdown (non-reasoning) is the primary readable payload.
	if (
		content.type === "markdown" &&
		content.isReasoning !== true &&
		content.role !== "user" &&
		typeof content.content === "string" &&
		content.content.trim() !== "" &&
		!isRulesDump(content.content)
	) {
		return { body: content.content, header: "" };
	}

	// Card bodies (tool results, hook notices, plan acceptances) are readable too.
	if (content.type === "card" && typeof content.card?.body === "string") {
		const cardHeader =
			typeof content.card?.header === "string" && content.card.header !== ""
				? content.card.header
				: "";
		return {
			body: content.card.body,
			header: cardHeader !== "" ? `> ${cardHeader}` : "",
		};
	}

	return undefined;
}

/** Ensure the directory for a log path exists so append/write calls succeed. */
export function ensureLogDir(logPath: string): void {
	try {
		mkdirSync(dirname(pathResolve(logPath)), { recursive: true });
	} catch {
		// Best-effort.
	}
}

/*
 * Agent log helpers.
 *
 * `.log` files are upstream `@ai-hero/sandcastle` file-mode logs verbatim
 * (`FileDisplay` output with `verbose: true`, so raw agent stdout JSONL is
 * interleaved) — the same behavior as before the three-file split.
 *
 * For dirac runs only, `fileLogging` additionally streams a clean markdown
 * digest into `<name>.dirac.log` as agent events arrive, so the readable
 * output is visible while the run is still in flight and survives failures.
 */

import type { AgentStreamEvent, LoggingOption } from "@ai-hero/sandcastle";

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

/**
 * Digest file path for a dirac run. Strips a trailing `.log` so `issue-1.log` maps to
 * `issue-1.dirac.log`.
 *
 * - @param logPath - Primary upstream log path.
 * - @returns Path of the dirac-only markdown digest.
 */
export function diracDigestPath(logPath: string): string {
	return logPath.endsWith(".log")
		? `${logPath.slice(0, -".log".length)}.dirac.log`
		: `${logPath}.dirac.log`;
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
 * behavior). When `digest` is set (dirac runs), the digest file is created synchronously with a
 * header and `Run started` marker, and every subsequent `raw` stream event is rendered to markdown
 * and appended immediately — so the digest exists from run start even if the run fails or is killed
 * mid-flight.
 *
 * - @param logPath - Primary upstream log path.
 * - @param options - Set `digest: true` for dirac runs to stream `<name>.dirac.log`.
 * - @returns Logging options for the sandbox `run()` call.
 */
export function fileLogging(logPath: string, options?: { digest?: boolean }): LoggingOption {
	const digestPath = options?.digest === true ? diracDigestPath(logPath) : undefined;
	if (digestPath !== undefined) {
		ensureLogDir(digestPath);
		try {
			if (!existsSync(digestPath)) {
				writeFileSync(
					digestPath,
					`# Readable agent log digest\n\n--- Run started: ${formatRunStarted()} ---\n`,
					"utf-8",
				);
			} else {
				appendFileSync(digestPath, `\n--- Run started: ${formatRunStarted()} ---\n`);
			}
		} catch {
			// Best-effort: digest capture must never break the run.
		}
	}

	const onAgentStreamEvent =
		digestPath === undefined
			? undefined
			: (event: AgentStreamEvent): void => {
					if (event.type !== "raw") {
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
						appendFileSync(digestPath, entry);
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
 * Extracts a readable rendering from a single raw stream event line, or `undefined` when the line
 * carries nothing worth rendering (reasoning traces, token usage, control events).
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
	};
	try {
		parsed = JSON.parse(line) as typeof parsed;
	} catch {
		return undefined;
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
		content.content.trim() !== ""
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

/*
 * Provider-failure detection and retry for agent sandbox runs.
 *
 * A phase run is retried indefinitely by default: providers fail transiently
 * (rate limits, HTTP 5xx, connection resets, stream drops) and each retry
 * resumes the agent session captured from the previous attempt when one exists
 * (see `session-resume.ts`), so the conversation context survives the failure.
 * The only errors that propagate immediately are ones no retry can fix — bad
 * credentials, unknown models, missing binaries. `SANDCASTLE_PHASE_MAX_RETRIES`
 * caps the retries when a caller wants exhaustion instead of persistence.
 */

import { PhaseBudgetError } from "./markers.js";
import { ZcodePreflightError } from "./providers/zcode-preflight.js";
import { io } from "./runtime.js";

const INITIAL_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 300;

/**
 * Errors that retrying cannot fix; the phase fails on the first occurrence.
 *
 * Matched against the lowercased error string, which for an agent failure is the provider's stderr
 * (HTTP status lines, provider error dumps). The list is deliberately narrow: everything else —
 * including unrecognized errors — is treated as transient and retried.
 */
const FATAL_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
	/\b40[13]\b/, // HTTP 401/403: credentials
	/unauthorized/,
	/forbidden/,
	/authentication/,
	/invalid[ _-]api[ _-]?key/,
	/incorrect[ _-]api[ _-]?key/,
	/missing[ _-]api[ _-]?key/,
	// Unknown model/config: zcode reports 「Provider Registry 中不存在 Model」.
	/不存在/,
	/provider registry/,
	/unknown model/,
	/model[ _-]not[ _-]?found/,
	// Environment/setup failures that would repeat on every attempt.
	/binary not found/,
	/无法定位/,
];
/**
 * Whether an error is hopeless — retrying it can never succeed.
 *
 * @param err - The thrown phase error.
 * @returns `true` only for credential, model-selection, and setup failures.
 */
export function isFatalProviderError(err: unknown): boolean {
	// A wall-clock kill is the trigger for a resume-backed retry, never a dead end.
	if (err instanceof PhaseBudgetError) {
		return false;
	}

	// A provably invalid model/effort selection needs operator action, not retries.
	if (err instanceof ZcodePreflightError) {
		return true;
	}

	const msg = String(err).toLowerCase();
	return FATAL_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

/** Retry cap from `SANDCASTLE_PHASE_MAX_RETRIES`; unset or invalid means no cap. */
function resolveDefaultMaxRetries(): number {
	const raw = (process.env.SANDCASTLE_PHASE_MAX_RETRIES ?? "").trim();
	if (raw === "") {
		return Number.POSITIVE_INFINITY;
	}

	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 0) {
		console.warn(`  ⚠ Invalid SANDCASTLE_PHASE_MAX_RETRIES "${raw}" — retrying indefinitely.`);
		return Number.POSITIVE_INFINITY;
	}

	return parsed;
}

/**
 * Bounded error detail for the retry log. Agent failures carry the real cause on later lines (the
 * first line is often just "zcode exited with code 1:"), so the summary keeps the leading lines up
 * to a small cap instead of one.
 */
function errorSummary(err: unknown): string {
	const summary = String(err)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.slice(0, 4)
		.join(" | ");
	return summary.length > 400 ? `${summary.slice(0, 397)}...` : summary;
}

/**
 * Wraps a sandbox.run() call with retry logic for transient provider errors.
 *
 * Retries indefinitely by default — set `maxRetries` (or the `SANDCASTLE_PHASE_MAX_RETRIES` env) to
 * cap the retries; fatal errors (see {@link isFatalProviderError}) always propagate immediately.
 * Backoff starts at 30s and doubles up to a 5-minute cap, so an endpoint outage spanning hours
 * still recovers into the same phase run.
 *
 * @param sandboxRun - The phase invocation; each attempt starts fresh.
 * @param phaseName - Label used in retry log lines.
 * @param maxRetries - Retries after the first attempt; defaults to the
 *   `SANDCASTLE_PHASE_MAX_RETRIES` env, or unlimited when unset.
 * @returns Whatever `sandboxRun` resolves with on the first successful attempt.
 * @rejects {Error} When the phase fails for a fatal reason or retries are exhausted.
 */
export async function runPhaseWithRetry<T>(
	sandboxRun: () => Promise<T>,
	phaseName: string,
	maxRetries?: number,
): Promise<T> {
	const resolvedMaxRetries = maxRetries ?? resolveDefaultMaxRetries();
	const startedAt = Date.now();

	for (let attempt = 1; ; attempt++) {
		try {
			return await sandboxRun();
		} catch (err) {
			if (isFatalProviderError(err) || attempt > resolvedMaxRetries) {
				throw err;
			}

			const backoffSeconds = Math.min(
				INITIAL_BACKOFF_SECONDS * 2 ** (attempt - 1),
				MAX_BACKOFF_SECONDS,
			);
			console.warn(
				`  ⚠ ${phaseName} failed (attempt ${attempt} of ${
					resolvedMaxRetries === Number.POSITIVE_INFINITY
						? "unlimited"
						: String(resolvedMaxRetries + 1)
				}). Retrying in ${backoffSeconds}s...`,
			);
			console.warn(`    ${errorSummary(err)}`);
			if (attempt % 10 === 0) {
				const elapsedMinutes = Math.round((Date.now() - startedAt) / 60_000);
				console.warn(
					`  ⚠ ${phaseName}: still retrying after ${elapsedMinutes} min (attempt ${attempt})...`,
				);
			}

			await io.sleep(backoffSeconds * 1000);
		}
	}
}

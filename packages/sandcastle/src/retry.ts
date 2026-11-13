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

import { CancelError, cancellation } from "./cancel.js";
import { PhaseBudgetError } from "./markers.js";
import { ZcodePreflightError } from "./providers/zcode-preflight.js";
import { ConfigReloadError } from "./reload.js";
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
	/*
	 * Cancellation is not a failure to retry: the operator asked for the run to stop, so retrying
	 * would sleep through the backoff and resume work they stopped. It is checked here as well as in
	 * the loop so every existing caller of this predicate agrees about it.
	 */
	if (err instanceof CancelError) {
		return true;
	}

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
		/*
		 * Checked before every attempt so a cancellation that arrived during a backoff sleep stops
		 * the loop instead of starting one more agent run.
		 */
		if (cancellation.requested()) {
			throw new CancelError();
		}

		try {
			return await sandboxRun();
		} catch (err) {
			/*
			 * A cancellation is reported in preference to whatever error it interrupted. The operator
			 * asked for the run to stop, so calling this attempt a failure would misreport the exit code
			 * (130 becomes 1) and send them looking for a bug that is only the stop. The message the
			 * attempt carried is dropped for the same reason: it describes a phase nobody finished.
			 */
			if (cancellation.requested()) {
				throw new CancelError();
			}

			/*
			 * A reload is neither a failure nor an ordinary retry: the operator asked for a different
			 * model, so the attempt restarts at once on the new one. Counting it would let a handful of
			 * deliberate switches exhaust `SANDCASTLE_PHASE_MAX_RETRIES`, and backing off would leave the
			 * run idle for minutes on a change that is already read and ready.
			 */
			if (err instanceof ConfigReloadError) {
				console.warn(`  ↻ ${err.message} Restarting on the new selection.`);
				continue;
			}

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

			await sleepUnlessCancelled(backoffSeconds * 1000);
		}
	}
}

/**
 * - Sleeps for `ms`, ending early when an operator cancels.
 * - @param ms - Backoff duration in milliseconds.
 *
 * @remarks
 *   A backoff can last five minutes, so a plain sleep would make `Ctrl+C` look ignored for that
 *   long. Racing the cancel signal keeps the retry loop's delay but lets the request through. The
 *   listener is removed on both paths: retries are unlimited by default, so a leak here would grow
 *   one listener per attempt for the life of the process.
 */
async function sleepUnlessCancelled(ms: number): Promise<void> {
	/* Captured, because `reset` can replace the signal before this settles. */
	const { signal } = cancellation;
	if (signal.aborted) {
		return;
	}

	let onAbort = (): void => undefined;
	try {
		await Promise.race([
			io.sleep(ms),
			new Promise<void>((resolve) => {
				onAbort = (): void => {
					resolve();
				};

				signal.addEventListener("abort", onAbort, { once: true });
			}),
		]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

/*
 * Rate-limit detection and retry for agent sandbox runs.
 */

import { io } from "./runtime.js";

export function isRateLimitError(err: unknown): boolean {
	const msg = String(err).toLowerCase();
	return (
		msg.includes("429") ||
		msg.includes("rate_limit") ||
		msg.includes("rate limit") ||
		msg.includes("too many requests") ||
		msg.includes("quota exceeded") ||
		msg.includes("resource_exhausted")
	);
}

/**
 * Wraps a sandbox.run() call with retry logic for rate-limit errors. Other errors propagate
 * immediately.
 *
 * @rejects {Error} When the phase fails for a non-rate-limit reason or retries are exhausted.
 */
export async function runPhaseWithRetry(
	sandboxRun: () => Promise<{ commits: Array<{ sha: string }>; stdout: string }>,
	phaseName: string,
	maxRetries = 3,
): Promise<{ commits: Array<{ sha: string }>; stdout: string }> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await sandboxRun();
		} catch (err) {
			if (isRateLimitError(err) && attempt < maxRetries) {
				const backoff = 30 * attempt;
				console.warn(
					`  ⚠ Rate limited during ${phaseName}. Retrying in ${backoff}s (attempt ${attempt}/${maxRetries})...`,
				);
				await io.sleep(backoff * 1000);
				continue;
			}

			throw err;
		}
	}

	throw new Error("unreachable");
}

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isRateLimitError, runPhaseWithRetry } from "./retry.js";
import { io } from "./runtime.js";
import { registerTestHooks } from "./test-helpers.js";

registerTestHooks();

describe("rate limit detection and retry", () => {
	test("isRateLimitError matches known phrases", () => {
		assert.equal(isRateLimitError("HTTP 429"), true);
		assert.equal(isRateLimitError("rate_limit exceeded"), true);
		assert.equal(isRateLimitError("Rate Limit"), true);
		assert.equal(isRateLimitError("Too Many Requests"), true);
		assert.equal(isRateLimitError("quota exceeded"), true);
		assert.equal(isRateLimitError("resource_exhausted"), true);
		assert.equal(isRateLimitError("boom"), false);
	});

	test("runPhaseWithRetry retries rate limits and rethrows other errors", async () => {
		const sleeps: Array<number> = [];
		io.sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		let attempts = 0;
		const result = await runPhaseWithRetry(async () => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error("429 rate limit");
			}

			return { commits: [{ sha: "abc" }], stdout: "ok" };
		}, "design");
		assert.equal(result.stdout, "ok");
		assert.equal(attempts, 3);
		assert.deepEqual(sleeps, [30_000, 60_000]);

		await assert.rejects(
			async () =>
				runPhaseWithRetry(async () => {
					throw new Error("fatal");
				}, "implement"),
			/fatal/,
		);

		await assert.rejects(
			async () =>
				runPhaseWithRetry(
					async () => {
						throw new Error("quota exceeded");
					},
					"review",
					2,
				),
			/quota exceeded/,
		);
	});
});

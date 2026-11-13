import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { afterEach, describe, test } from "vitest";

import { CancelError, cancellation } from "./cancel.js";
import { isFatalProviderError, runPhaseWithRetry } from "./retry.js";
import { io } from "./runtime.js";
import { registerTestHooks } from "./test-helpers.js";

registerTestHooks();

describe("fatal provider error detection", () => {
	test("isFatalProviderError matches credential, model, and setup failures", () => {
		assert.equal(isFatalProviderError("HTTP 401 Unauthorized"), true);
		assert.equal(isFatalProviderError("403 Forbidden"), true);
		assert.equal(isFatalProviderError("invalid_api_key provided"), true);
		assert.equal(isFatalProviderError("authentication failed"), true);
		assert.equal(isFatalProviderError("Provider Registry 中不存在 Model"), true);
		assert.equal(isFatalProviderError("unknown model: nope"), true);
		assert.equal(isFatalProviderError("zcode binary not found"), true);
		assert.equal(isFatalProviderError("无法定位 CLI ZCode Built-in Provider Config"), true);
	});

	test("isFatalProviderError treats transient provider failures as retryable", () => {
		assert.equal(isFatalProviderError("boom"), false);
		assert.equal(isFatalProviderError("HTTP 429 too many requests"), false);
		assert.equal(isFatalProviderError("HTTP 500 internal_server_error"), false);
		assert.equal(
			isFatalProviderError(
				"read tcp 1.2.3.4:5->5.6.7.8:443: wsarecv: connection forcibly closed",
			),
			false,
		);
		assert.equal(isFatalProviderError("zcode exited with code 1"), false);
	});
});

describe("phase retry", () => {
	const savedEnvValue = process.env.SANDCASTLE_PHASE_MAX_RETRIES;

	afterEach(() => {
		if (savedEnvValue === undefined) {
			delete process.env.SANDCASTLE_PHASE_MAX_RETRIES;
		} else {
			process.env.SANDCASTLE_PHASE_MAX_RETRIES = savedEnvValue;
		}
	});

	test("retries transient provider failures until success, with capped exponential backoff", async () => {
		// registerTestHooks caps retries globally; this test pins the unlimited default.
		delete process.env.SANDCASTLE_PHASE_MAX_RETRIES;
		const sleeps: Array<number> = [];
		io.sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		let attempts = 0;
		const result = await runPhaseWithRetry(async () => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error("zcode exited with code 1: read tcp ... wsarecv: forcibly closed");
			}

			return { commits: [{ sha: "abc" }], stdout: "ok" };
		}, "design");
		assert.equal(result.stdout, "ok");
		assert.equal(attempts, 3);
		assert.deepEqual(sleeps, [30_000, 60_000]);

		let backoffAttempts = 0;
		await runPhaseWithRetry(async () => {
			backoffAttempts += 1;
			if (backoffAttempts < 6) {
				throw new Error("429 rate limit");
			}

			return "done";
		}, "review");
		// Backoff doubles from 30s and caps at the 5-minute ceiling.
		assert.deepEqual(sleeps.slice(2), [30_000, 60_000, 120_000, 240_000, 300_000]);
		assert.equal(backoffAttempts, 6);
	});

	test("the retry log includes the error's later lines", async () => {
		/*
		 * Agent failures carry the real cause after the first line ("zcode exited
		 * with code 1:"); the one-line retry warning must show it, not truncate.
		 */
		process.env.SANDCASTLE_PHASE_MAX_RETRIES = "1";
		io.sleep = async () => {};

		const logged: Array<string> = [];
		const original = console.warn;
		console.warn = (...args: Array<unknown>) => {
			logged.push(args.join(" "));
		};

		try {
			await assert.rejects(async () =>
				runPhaseWithRetry(async () => {
					throw new Error(
						"zcode exited with code 1:\nzcode-wrapper: session/resume failed: Invalid params",
					);
				}, "review"),
			);
		} finally {
			console.warn = original;
		}

		const summary = logged.find((line) => line.includes("session/resume failed"));
		assert.ok(summary !== undefined, `no multi-line summary in ${JSON.stringify(logged)}`);
	});

	test("fatal errors rethrow immediately without sleeping", async () => {
		const sleeps: Array<number> = [];
		io.sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		let attempts = 0;
		await assert.rejects(
			async () =>
				runPhaseWithRetry(async () => {
					attempts += 1;
					throw new Error("HTTP 401 Unauthorized: invalid api key");
				}, "implement"),
			/401 Unauthorized/,
		);
		assert.equal(attempts, 1);
		assert.deepEqual(sleeps, []);
	});

	test("a cancellation is never retried", async () => {
		const sleeps: Array<number> = [];
		io.sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		let attempts = 0;
		await assert.rejects(
			async () =>
				runPhaseWithRetry(async () => {
					attempts += 1;
					throw new CancelError();
				}, "implement"),
			(err: unknown) => err instanceof CancelError,
		);
		assert.equal(attempts, 1, "a cancelled phase must not start another agent run");
		assert.deepEqual(sleeps, [], "and must not sleep through a backoff either");
	});

	test("a cancellation requested mid-run stops the loop at the next attempt", async () => {
		const sleeps: Array<number> = [];
		io.sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		let attempts = 0;
		await assert.rejects(
			async () =>
				runPhaseWithRetry(async () => {
					attempts += 1;
					/*
					 * The first attempt fails transiently and the operator cancels while the retry is
					 * pending. The backoff must not swallow the request: that 30s→300s sleep is exactly
					 * where `Ctrl+C` used to look ignored.
					 */
					cancellation.request();
					throw new Error("connection reset");
				}, "design"),
			(err: unknown) => err instanceof CancelError,
		);

		assert.equal(attempts, 1);
		assert.equal(sleeps.length, 0, "the sleep must end as soon as the signal fires");
	});

	test("a backoff sleep ends early when the operator cancels", async () => {
		/*
		 * Retries are enabled for this case: the shared hooks cap them at 0, and the point is what
		 * happens during a backoff, which only exists when a retry is allowed.
		 */
		process.env.SANDCASTLE_PHASE_MAX_RETRIES = "5";
		let attempts = 0;
		let slept = 0;
		const started = Date.now();
		io.sleep = async (ms: number) => {
			slept += 1;
			/* Stands in for the 30s delay, but the request lands while it is "sleeping". */
			cancellation.request();
			await new Promise<void>((resolve) => {
				if (cancellation.signal.aborted) {
					resolve();
					return;
				}

				cancellation.signal.addEventListener("abort", () => resolve(), { once: true });
			});
			void ms;
		};

		await assert.rejects(
			async () =>
				runPhaseWithRetry(async () => {
					attempts += 1;
					throw new Error("socket hang up");
				}, "review"),
			(err: unknown) => err instanceof CancelError,
		);

		assert.equal(attempts, 1, "the cancelled backoff must not lead to another attempt");
		assert.equal(slept, 1, "it did reach the backoff, which is what this test is about");
		assert.ok(Date.now() - started < 5_000, "the 30s backoff must not have been waited out");
	});

	test("repeated failures do not accumulate abort listeners", async () => {
		/*
		 * Retries are unlimited by default and a run can spend hours in them, so a listener added per
		 * attempt and never removed would grow without bound on the process-wide signal — eventually
		 * tripping Node's MaxListenersExceededWarning and keeping every finished attempt's closure
		 * alive. Counted directly, because that is the thing that leaks.
		 */
		process.env.SANDCASTLE_PHASE_MAX_RETRIES = "4";
		io.sleep = async () => {};

		const { signal } = cancellation;
		const before = getEventListeners(signal, "abort").length;

		await assert.rejects(
			async () =>
				runPhaseWithRetry(async () => {
					throw new Error("connection reset");
				}, "design"),
			/connection reset/u,
		);

		assert.equal(
			getEventListeners(signal, "abort").length,
			before,
			"every attempt's listener must be removed when it settles",
		);
	});

	test("SANDCASTLE_PHASE_MAX_RETRIES caps retries and rethrows the original error", async () => {
		process.env.SANDCASTLE_PHASE_MAX_RETRIES = "2";
		const sleeps: Array<number> = [];
		io.sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		let attempts = 0;
		await assert.rejects(
			async () =>
				runPhaseWithRetry(async () => {
					attempts += 1;
					throw new Error("quota exceeded");
				}, "review"),
			/quota exceeded/,
		);
		assert.equal(attempts, 3);
		assert.deepEqual(sleeps, [30_000, 60_000]);
	});

	test("explicit maxRetries overrides the env cap", async () => {
		process.env.SANDCASTLE_PHASE_MAX_RETRIES = "0";
		io.sleep = async () => {};

		let attempts = 0;
		const result = await runPhaseWithRetry(
			async () => {
				attempts += 1;
				if (attempts < 3) {
					throw new Error("500 server error");
				}

				return "recovered";
			},
			"design",
			5,
		);
		assert.equal(result, "recovered");
		assert.equal(attempts, 3);
	});

	test("invalid SANDCASTLE_PHASE_MAX_RETRIES falls back to unlimited", async () => {
		process.env.SANDCASTLE_PHASE_MAX_RETRIES = "many";
		io.sleep = async () => {};

		let attempts = 0;
		const result = await runPhaseWithRetry(async () => {
			attempts += 1;
			if (attempts < 2) {
				throw new Error("connection reset");
			}

			return "ok";
		}, "design");
		assert.equal(result, "ok");
		assert.equal(attempts, 2);
	});
});

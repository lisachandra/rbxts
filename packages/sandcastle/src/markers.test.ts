/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { PhaseBudgetError, resolvePhaseBudgetMs, runMarkerPhase } from "./markers.js";
import { isFatalProviderError } from "./retry.js";
import { registerTestHooks } from "./test-helpers.js";

registerTestHooks();

const tmpDirs: Array<string> = [];

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe("phase budget", () => {
	const savedBudget = process.env.SANDCASTLE_PHASE_BUDGET_MINUTES;

	afterEach(() => {
		if (savedBudget === undefined) {
			delete process.env.SANDCASTLE_PHASE_BUDGET_MINUTES;
		} else {
			process.env.SANDCASTLE_PHASE_BUDGET_MINUTES = savedBudget;
		}
	});

	function markerPathFor(): string {
		const dir = mkdtempSync(join(tmpdir(), "sandcastle-budget-"));
		tmpDirs.push(dir);
		return join(dir, "test-phase.completed");
	}

	test("resolvePhaseBudgetMs defaults to 120 minutes", () => {
		delete process.env.SANDCASTLE_PHASE_BUDGET_MINUTES;
		assert.equal(resolvePhaseBudgetMs(), 120 * 60_000);
	});

	test("resolvePhaseBudgetMs reads the env, 0 disables, invalid falls back", () => {
		process.env.SANDCASTLE_PHASE_BUDGET_MINUTES = "5";
		assert.equal(resolvePhaseBudgetMs(), 5 * 60_000);

		process.env.SANDCASTLE_PHASE_BUDGET_MINUTES = "0";
		assert.equal(resolvePhaseBudgetMs(), 0);

		process.env.SANDCASTLE_PHASE_BUDGET_MINUTES = "banana";
		assert.equal(resolvePhaseBudgetMs(), 120 * 60_000);
	});

	test("an attempt that outlives the budget is killed with PhaseBudgetError", async () => {
		process.env.SANDCASTLE_PHASE_BUDGET_MINUTES = "1";
		const marker = markerPathFor();
		/*
		 * A 1-minute real hang would slow the suite, so the run resolves on the
		 * abort event itself — the same rejection upstream's signal handling
		 * produces (`signal.throwIfAborted()` surfaces the reason).
		 */
		await assert.rejects(
			runMarkerPhase({
				agentBackend: "dirac",
				effort: "high",
				marker,
				model: "m",
				name: "budget test",
				promptArgs: {},
				promptFile: "unused.md",
				run: (options) =>
					new Promise<never>((_resolve, reject) => {
						options.signal?.addEventListener("abort", () => {
							reject(options.signal?.reason);
						});
					}),
			}),
			(error: unknown) => {
				assert.ok(
					error instanceof PhaseBudgetError,
					`expected PhaseBudgetError, got ${error}`,
				);
				assert.match(String(error), /Phase budget exceeded/);
				return true;
			},
		);
	});

	test("a completed attempt is unaffected by the budget timer", async () => {
		process.env.SANDCASTLE_PHASE_BUDGET_MINUTES = "1";
		const marker = markerPathFor();
		// runMarkerPhase fails without a marker; the point is the budget didn't fire first.
		await assert.rejects(
			runMarkerPhase({
				agentBackend: "dirac",
				effort: "high",
				marker,
				model: "m",
				name: "budget test",
				promptArgs: {},
				promptFile: "unused.md",
				run: async () => ({ commits: [] }) as never,
			}),
			/marker/,
		);
	});

	test("PhaseBudgetError is retryable, not fatal", () => {
		assert.equal(isFatalProviderError(new PhaseBudgetError(120)), false);
	});
});

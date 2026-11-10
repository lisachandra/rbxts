import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		/*
		 * Explicit, so vitest never picks up compiled copies under `dist/` or fixtures elsewhere in
		 * the repository: the suite lives beside the source it tests.
		 */
		include: ["src/**/*.test.ts"],
		/*
		 * The suite carries real-time tests — a phase attempt outlives its budget on purpose, and
		 * agent stubs wait on idle watchdogs — so keep the generous ceiling node:test ran with
		 * instead of tripping vitest's 5s default.
		 */
		testTimeout: 120_000,
		hookTimeout: 30_000,
	},
});

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { main } from "./main.js";
import { ExitError, registerTestHooks, stubExit } from "./test-helpers.js";

registerTestHooks();

describe("main routing", () => {
	test("help and dry-run exit 0", async () => {
		const codes = stubExit();
		process.argv = ["node", "main.ts", "--help"];
		await assert.rejects(
			async () => main(),
			(err: unknown) => err instanceof ExitError && err.code === 0,
		);
		assert.deepEqual(codes, [0]);

		process.argv = ["node", "main.ts", "--issue", "1", "--dry-run", "--model", "m"];
		await assert.rejects(
			async () => main(),
			(err: unknown) => err instanceof ExitError && err.code === 0,
		);
	});

	test("missing issue number throws after help", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = "m";
		process.argv = ["node", "main.ts"];
		await assert.rejects(async () => main(), /issue number/);
	});

	test("integration-status requires name", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = "m";
		process.argv = ["node", "main.ts", "integration-status"];
		await assert.rejects(async () => main(), /--name is required/);
	});

	test("issue-sequence requires --sequential", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = "m";
		process.argv = ["node", "main.ts", "issue-sequence"];
		await assert.rejects(async () => main(), /--sequential is required/);
	});
});

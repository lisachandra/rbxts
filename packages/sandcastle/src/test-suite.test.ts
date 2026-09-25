/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";

import { repositoryRoot } from "./test-helpers.js";

/** Every `*.test.ts` under `src/`, as absolute paths. */
function testFiles(dir: string = join(repositoryRoot, "src")): Array<string> {
	const found: Array<string> = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...testFiles(path));
			continue;
		}

		if (entry.name.endsWith(".test.ts")) {
			found.push(path);
		}
	}

	return found;
}

/** Reads a script body from package.json without asserting a shape onto it. */
function scriptFor(scripts: unknown, name: string): string {
	if (typeof scripts !== "object" || scripts === null) {
		return "";
	}

	const value = Reflect.get(scripts, name);
	return typeof value === "string" ? value : "";
}

describe("package test script", () => {
	/**
	 * The test script enumerates files, so a new suite is silently skipped until it is added. That
	 * happened twice (`help.test.ts`, `queue/persist.test.ts`), which is why this guard exists.
	 */
	test("runs every test file in src/", () => {
		const parsed: unknown = JSON.parse(
			readFileSync(join(repositoryRoot, "package.json"), "utf-8"),
		);
		const scripts =
			typeof parsed === "object" && parsed !== null
				? Reflect.get(parsed, "scripts")
				: undefined;

		const missing: Array<string> = [];
		for (const file of testFiles()) {
			const relativePath = relative(repositoryRoot, file).split("\\").join("/");
			for (const name of ["test", "test:coverage"]) {
				if (!scriptFor(scripts, name).includes(relativePath)) {
					missing.push(`${relativePath} (${name})`);
				}
			}
		}

		assert.deepEqual(missing, []);
	});
});

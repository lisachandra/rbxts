import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "vitest";

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
	 * The test script used to enumerate files, so a new suite was silently skipped until it was
	 * added — that happened twice (`help.test.ts`, `queue/persist.test.ts`). Vitest discovers by
	 * glob, so the guard now asserts the scripts run vitest and never enumerate a test file again:
	 * a listed file would run twice alongside the glob discovery, and a list is how a suite gets
	 * silently dropped.
	 */
	test("runs vitest by glob and never enumerates a test file", () => {
		const parsed: unknown = JSON.parse(
			readFileSync(join(repositoryRoot, "package.json"), "utf-8"),
		);
		const scripts =
			typeof parsed === "object" && parsed !== null
				? Reflect.get(parsed, "scripts")
				: undefined;

		const enumerated: Array<string> = [];
		for (const name of ["test", "test:coverage"]) {
			const script = scriptFor(scripts, name);
			assert.match(script, /vitest run/u, `${name} runs vitest`);
			for (const file of testFiles()) {
				const relativePath = relative(repositoryRoot, file).split("\\").join("/");
				if (script.includes(relativePath)) {
					enumerated.push(`${relativePath} (${name})`);
				}
			}
		}

		assert.deepEqual(enumerated, []);
	});
});

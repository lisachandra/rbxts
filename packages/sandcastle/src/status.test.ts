/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { printStatus } from "./status.js";
import { gitStub, registerTestHooks } from "./test-helpers.js";

registerTestHooks();

/** Captures sequentially the lines printed by `run`. */
function captureOutput(run: () => void): Array<string> {
	const lines: Array<string> = [];
	const original = console.log;
	console.log = (...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	};

	try {
		run();
	} finally {
		console.log = original;
	}

	return lines;
}

describe("printStatus", () => {
	test("prints the issue title resolved through issueMetadata", () => {
		gitStub({
			file: (args) => {
				if (args[0] === "rev-list" && args[1] === "--count") {
					return "0";
				}

				return undefined;
			},
			sync: (command) => {
				if (command.includes("gh issue view")) {
					return JSON.stringify({ labels: [{ name: "ecs" }], title: "Title A" });
				}

				return undefined;
			},
		});

		const lines = captureOutput(() => printStatus("42", "model-x", "main"));

		assert.ok(
			lines.some((line) => line.includes("Issue #42: Title A")),
			`expected issue header line, got: ${JSON.stringify(lines)}`,
		);
	});

	test("falls back to a placeholder title when gh fails", () => {
		gitStub({
			file: (args) => {
				if (args[0] === "rev-list" && args[1] === "--count") {
					return "0";
				}

				return undefined;
			},
			sync: () => {
				throw new Error("gh down");
			},
		});

		const lines = captureOutput(() => printStatus("7", "model-x", "main"));

		assert.ok(
			lines.some((line) => line.includes("Issue #7: (could not fetch)")),
			`expected fallback issue header line, got: ${JSON.stringify(lines)}`,
		);
	});
});

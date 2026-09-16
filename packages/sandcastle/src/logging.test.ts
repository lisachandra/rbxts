/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { diracDigestPath, fileLogging, formatRunStarted } from "./logging.js";
import { registerTestHooks } from "./test-helpers.js";

registerTestHooks();

const tmpDirs: Array<string> = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sandcastle-logging-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

/** Builds a raw agent-stream event carrying the given stdout line. */
function rawEvent(line: string): {
	iteration: number;
	line: string;
	timestamp: Date;
	type: "raw";
} {
	return { type: "raw", iteration: 1, line, timestamp: new Date() };
}

function markdownLine(content: string, extra?: Record<string, unknown>): string {
	return JSON.stringify({
		content: {
			type: "markdown",
			content,
			isReasoning: false,
			role: "assistant",
			...extra,
		},
		ts: 1,
	});
}

describe("fileLogging", () => {
	test("returns upstream file logging with verbose on", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		const logging = fileLogging(logPath);

		assert.equal(logging.type, "file");
		if (logging.type !== "file") {
			return;
		}

		assert.equal(logging.path, logPath);
		assert.equal(logging.verbose, true);
		assert.equal(logging.onAgentStreamEvent, undefined);
		assert.equal(existsSync(diracDigestPath(logPath)), false);
	});

	test("creates the dirac digest immediately with a run marker", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		fileLogging(logPath, { digest: true });

		const digest = readFileSync(diracDigestPath(logPath), "utf-8");
		assert.match(digest, /# Readable agent log digest/);
		assert.match(digest, /--- Run started:.*---/);
		assert.match(digest, /\(local: .*GMT[+-]\d{2}:\d{2}\)/);
	});

	test("streams markdown and card bodies into the digest live", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		const logging = fileLogging(logPath, { digest: true });
		if (logging.type !== "file" || logging.onAgentStreamEvent === undefined) {
			assert.fail("expected file logging with an event handler");
		}

		logging.onAgentStreamEvent(rawEvent(markdownLine("# Heading\n\nBody")));
		// Visible before the run ends — no finalize step required.
		let digest = readFileSync(diracDigestPath(logPath), "utf-8");
		assert.match(digest, /# Heading/);
		assert.match(digest, /Body/);

		logging.onAgentStreamEvent(
			rawEvent(
				JSON.stringify({
					content: { type: "card", card: { body: "plan body", header: "Plan Accepted" } },
					ts: 2,
				}),
			),
		);
		digest = readFileSync(diracDigestPath(logPath), "utf-8");
		assert.match(digest, /> Plan Accepted/);
		assert.match(digest, /plan body/);
	});

	test("filters reasoning, user, and empty-content events", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		const logging = fileLogging(logPath, { digest: true });
		if (logging.type !== "file" || logging.onAgentStreamEvent === undefined) {
			assert.fail("expected file logging with an event handler");
		}

		logging.onAgentStreamEvent(
			rawEvent(markdownLine("reasoning trace", { isReasoning: true })),
		);
		logging.onAgentStreamEvent(rawEvent(markdownLine("user prompt", { role: "user" })));
		logging.onAgentStreamEvent(rawEvent(JSON.stringify({ content: { type: "api_status" } })));
		logging.onAgentStreamEvent(rawEvent("not-json"));
		logging.onAgentStreamEvent(rawEvent(markdownLine("real assistant answer", {})));

		const digest = readFileSync(diracDigestPath(logPath), "utf-8");
		assert.match(digest, /real assistant answer/);
		assert.doesNotMatch(digest, /reasoning trace/);
		assert.doesNotMatch(digest, /user prompt/);
	});

	test("appends a new marker when the digest already exists", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		fileLogging(logPath, { digest: true });
		fileLogging(logPath, { digest: true });

		const digest = readFileSync(diracDigestPath(logPath), "utf-8");
		assert.equal(digest.match(/--- Run started:/g)?.length, 2);
	});
});

describe("diracDigestPath", () => {
	test("strips the .log suffix", () => {
		assert.equal(diracDigestPath("/logs/issue-1.log"), "/logs/issue-1.dirac.log");
		assert.equal(diracDigestPath("/logs/issue-1"), "/logs/issue-1.dirac.log");
	});
});

describe("formatRunStarted", () => {
	test("pairs the UTC timestamp with local wall-clock time", () => {
		const now = new Date("2026-09-06T00:00:00.000Z");
		const marker = formatRunStarted(now);
		assert.match(marker, /^2026-09-06T00:00:00\.000Z \(local: /);
		const offsetMinutes = -now.getTimezoneOffset();
		const sign = offsetMinutes >= 0 ? "+" : "-";
		assert.ok(marker.includes(`GMT${sign}`), `expected local GMT offset in: ${marker}`);
	});
});

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { backendSupportsDigest, digestPath, fileLogging, formatRunStarted } from "./logging.js";
import { createSessionCapture } from "./providers/session-capture.js";
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
		assert.equal(existsSync(digestPath(logPath)), false);
	});

	test("creates the digest immediately with a run marker", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		fileLogging(logPath, { digest: true });

		const digest = readFileSync(digestPath(logPath), "utf-8");
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
		let digest = readFileSync(digestPath(logPath), "utf-8");
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
		digest = readFileSync(digestPath(logPath), "utf-8");
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

		const digest = readFileSync(digestPath(logPath), "utf-8");
		assert.match(digest, /real assistant answer/);
		assert.doesNotMatch(digest, /reasoning trace/);
		assert.doesNotMatch(digest, /user prompt/);
	});

	test("drops rules-context dumps from the digest", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		const logging = fileLogging(logPath, { digest: true });
		if (logging.type !== "file" || logging.onAgentStreamEvent === undefined) {
			assert.fail("expected file logging with an event handler");
		}

		logging.onAgentStreamEvent(
			rawEvent(
				markdownLine(
					JSON.stringify({
						rules: [{ name: "workspace:.diracrules\\rules\\typescript.md" }],
					}),
				),
			),
		);
		logging.onAgentStreamEvent(rawEvent(markdownLine("real assistant answer", {})));

		const digest = readFileSync(digestPath(logPath), "utf-8");
		assert.match(digest, /real assistant answer/);
		assert.doesNotMatch(digest, /workspace:.diracrules/);
	});

	test("renders zcode tool events with header and detail", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		const logging = fileLogging(logPath, { digest: true });
		if (logging.type !== "file" || logging.onAgentStreamEvent === undefined) {
			assert.fail("expected file logging with an event handler");
		}

		logging.onAgentStreamEvent(
			rawEvent(JSON.stringify({ type: "tool", name: "bash", state: "running" })),
		);
		logging.onAgentStreamEvent(
			rawEvent(
				JSON.stringify({
					type: "tool",
					detail: "echo stub-run\n→ stub-run",
					name: "bash",
					state: "completed",
				}),
			),
		);

		const digest = readFileSync(digestPath(logPath), "utf-8");
		assert.match(digest, /> bash \(completed\)/);
		assert.match(digest, /echo stub-run/);
		assert.match(digest, /→ stub-run/);
		// The running transition renders with its state and no detail body.
		assert.match(digest, /> bash \(running\)/);
		assert.match(digest, /\(running\)/);
	});

	test("appends a new marker when the digest already exists", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		fileLogging(logPath, { digest: true });
		fileLogging(logPath, { digest: true });

		const digest = readFileSync(digestPath(logPath), "utf-8");
		assert.equal(digest.match(/--- Run started:/g)?.length, 2);
	});

	test("fires onSessionCaptured write-through on the first session-id line", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		const captured: Array<string> = [];
		const logging = fileLogging(logPath, {
			digest: true,
			onSessionCaptured: (sessionId) => {
				captured.push(sessionId);
			},
			sessionCapture: createSessionCapture(),
		});
		if (logging.type !== "file" || logging.onAgentStreamEvent === undefined) {
			assert.fail("expected file logging with an event handler");
		}

		// Pre-session lines and unrelated JSON do not fire the sink.
		logging.onAgentStreamEvent(rawEvent(markdownLine("# Heading")));
		logging.onAgentStreamEvent(rawEvent("not-json"));
		assert.deepEqual(captured, []);

		logging.onAgentStreamEvent(
			rawEvent(JSON.stringify({ type: "session_id", sessionId: "session-a" })),
		);
		assert.deepEqual(captured, ["session-a"]);

		// The sink fires once; later ids (none expected per attempt) are ignored.
		logging.onAgentStreamEvent(
			rawEvent(JSON.stringify({ type: "session_id", sessionId: "session-b" })),
		);
		assert.deepEqual(captured, ["session-a"]);
	});

	test("a throwing onSessionCaptured never breaks the run", () => {
		const dir = tempDir();
		const logPath = join(dir, "issue-1.log");
		const logging = fileLogging(logPath, {
			digest: true,
			onSessionCaptured: () => {
				throw new Error("disk full");
			},
			sessionCapture: createSessionCapture(),
		});
		if (logging.type !== "file" || logging.onAgentStreamEvent === undefined) {
			assert.fail("expected file logging with an event handler");
		}

		const onEvent = logging.onAgentStreamEvent;

		assert.doesNotThrow(() => {
			onEvent(rawEvent(JSON.stringify({ type: "session_id", sessionId: "session-a" })));
			onEvent(rawEvent(markdownLine("# Heading")));
		});
		assert.match(readFileSync(digestPath(logPath), "utf-8"), /# Heading/);
	});
});

describe("digestPath", () => {
	test("strips the .log suffix", () => {
		assert.equal(digestPath("/logs/issue-1.log"), "/logs/issue-1.digest.log");
		assert.equal(digestPath("/logs/issue-1"), "/logs/issue-1.digest.log");
	});
});

describe("backendSupportsDigest", () => {
	test("enables dirac and zcode only", () => {
		assert.equal(backendSupportsDigest("dirac"), true);
		assert.equal(backendSupportsDigest("zcode"), true);
		assert.equal(backendSupportsDigest("pi"), false);
		assert.equal(backendSupportsDigest("claude-code"), false);
		assert.equal(backendSupportsDigest(undefined), false);
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

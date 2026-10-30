/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import type { SessionCapture } from "./providers/session-capture.js";
import { clearSession, loadSession, saveSession } from "./providers/session-store.js";
import {
	beginSessionedAttempt,
	endSessionedAttempt,
	isStaleSessionError,
	resumableSession,
	sessionResumeDisabled,
} from "./session-resume.js";
import { registerTestHooks } from "./test-helpers.js";

registerTestHooks();

const tmpDirs: Array<string> = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sandcastle-resume-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe("session resume", () => {
	test("resumableSession returns only a same-backend stored session", () => {
		const scope = `resume-${Date.now()}`;
		assert.equal(resumableSession(scope, "zcode"), undefined);

		saveSession(scope, { backend: "zcode", sessionId: "s-1" });
		assert.equal(resumableSession(scope, "zcode")?.sessionId, "s-1");
		assert.equal(resumableSession(scope, "dirac"), undefined, "backend must match");
		clearSession(scope);
	});

	test("resumableSession honors the opt-out env", () => {
		const scope = `resume-opt-out-${Date.now()}`;
		saveSession(scope, { backend: "dirac", sessionId: "t-1" });
		process.env.SANDCASTLE_NO_SESSION_RESUME = "1";
		try {
			assert.equal(sessionResumeDisabled(), true);
			assert.equal(resumableSession(scope, "dirac"), undefined);
		} finally {
			delete process.env.SANDCASTLE_NO_SESSION_RESUME;
		}

		assert.equal(resumableSession(scope, "dirac")?.sessionId, "t-1");
		clearSession(scope);
	});

	test("begin/end persist the captured id across a failed attempt", () => {
		const scope = `resume-fail-${Date.now()}`;
		let capture: undefined | SessionCapture;
		const resumed = beginSessionedAttempt({ backend: "dirac", scope }, (resolved) => {
			capture = resolved;
		});
		assert.equal(resumed, undefined);

		// The attempt announces a session then dies; the capture still holds it.
		capture!.onStreamLine('{"type":"task_started","taskId":"task-9"}');
		const outcome = endSessionedAttempt(scope, "dirac", capture!, resumed, new Error("boom"));
		assert.equal(outcome.capturedSessionId, "task-9");
		assert.equal(loadSession(scope)?.sessionId, "task-9");
		clearSession(scope);
	});

	test("endSessionedAttempt clears a stale resumed session", () => {
		const scope = `resume-stale-${Date.now()}`;
		saveSession(scope, { backend: "zcode", sessionId: "gone" });
		const resumed = resumableSession(scope, "zcode");
		assert.equal(resumed?.sessionId, "gone");

		/*
		 * The retry failed without surfacing a new session id and the backend
		 * rejected the id as unknown.
		 */
		let capture: undefined | SessionCapture;
		beginSessionedAttempt({ backend: "zcode", scope }, (resolved) => {
			capture = resolved;
		});
		const outcome = endSessionedAttempt(
			scope,
			"zcode",
			capture!,
			resumed,
			new Error("zcode request failed: session/resume: session not found"),
		);
		assert.equal(outcome.capturedSessionId, undefined);
		assert.equal(loadSession(scope), undefined, "stale session must be cleared");
	});

	test("endSessionedAttempt clears a session whose resume the schema rejected", () => {
		/*
		 * The real app-server rejects malformed resume params with a Zod
		 * "Unrecognized key" error; that can only mean the resume request itself
		 * is broken, so the store must drop the id instead of retrying forever.
		 */
		const scope = `resume-schema-${Date.now()}`;
		saveSession(scope, { backend: "zcode", sessionId: "schema-session" });
		const resumed = resumableSession(scope, "zcode");
		let capture: undefined | SessionCapture;
		beginSessionedAttempt({ backend: "zcode", scope }, (resolved) => {
			capture = resolved;
		});
		endSessionedAttempt(
			scope,
			"zcode",
			capture!,
			resumed,
			new Error('session/resume: Invalid params — (root): Unrecognized key: "model"'),
		);
		assert.equal(loadSession(scope), undefined, "schema-rejected resume must be cleared");
	});

	test("endSessionedAttempt keeps the store for ordinary failures", () => {
		const scope = `resume-keep-${Date.now()}`;
		saveSession(scope, { backend: "zcode", sessionId: "keep" });
		const resumed = resumableSession(scope, "zcode");
		let capture: undefined | SessionCapture;
		beginSessionedAttempt({ backend: "zcode", scope }, (resolved) => {
			capture = resolved;
		});
		endSessionedAttempt(scope, "zcode", capture!, resumed, new Error("HTTP 500"));
		assert.equal(loadSession(scope)?.sessionId, "keep");
		clearSession(scope);
	});

	test("beginSessionedAttempt logs the resume", () => {
		const scope = `resume-log-${Date.now()}`;
		saveSession(scope, { backend: "dirac", sessionId: "t-7" });
		const logs: Array<string> = [];
		const original = console.log;
		console.log = (...args: Array<unknown>) => {
			logs.push(args.join(" "));
		};

		try {
			beginSessionedAttempt({ backend: "dirac", scope }, () => undefined);
		} finally {
			console.log = original;
		}

		assert.ok(
			logs.some(
				(line) => line.includes("Resuming dirac session t-7") && line.includes(scope),
			),
			`no resume log in ${JSON.stringify(logs)}`,
		);
		clearSession(scope);
	});

	test("isStaleSessionError matches the backends' not-found messages", () => {
		assert.equal(isStaleSessionError(new Error("Task not found: 1792")), true);
		assert.equal(isStaleSessionError(new Error("session not found")), true);
		assert.equal(
			isStaleSessionError(
				new Error('session/resume: Invalid params — (root): Unrecognized key: "model"'),
			),
			true,
		);
		assert.equal(isStaleSessionError(new Error("HTTP 500 upstream exploded")), false);
	});

	test("resume temp dir helper is exercised (store lives in stateRoot)", () => {
		/*
		 * The store path comes from stateRoot, not tmp; the temp dir helper keeps
		 * this file consistent with the other suites' cleanup pattern.
		 */
		assert.ok(tempDir().length > 0);
	});
});

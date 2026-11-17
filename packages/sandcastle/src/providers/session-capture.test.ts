import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { registerTestHooks } from "../test-helpers.js";
import { createSessionCapture } from "./session-capture.js";

registerTestHooks();

describe("createSessionCapture", () => {
	test("captures dirac task_started and zcode session_id from raw lines", () => {
		const capture = createSessionCapture();
		assert.equal(capture.sessionId(), undefined);

		capture.onStreamLine("noise before json");
		capture.onStreamLine('{"type":"task_started","taskId":"task-1"}');
		assert.equal(capture.sessionId(), "task-1");

		// A later announcement (e.g. zcode's wrapper shape) replaces the id.
		capture.onStreamLine('{"type":"session_id","sessionId":"session-2"}');
		assert.equal(capture.sessionId(), "session-2");

		// Non-JSON and JSON without session data leave the capture untouched.
		capture.onStreamLine("{broken");
		capture.onStreamLine('{"type":"text","text":"partial"}');
		assert.equal(capture.sessionId(), "session-2");
	});

	/*
	 * A session id is echoed by the agent on its own stdout, so a prompt-injected agent chooses it.
	 * It is then persisted and interpolated into a provider command on the next retry, which is why
	 * a value that is not a token is dropped at capture instead of quoted and passed along.
	 */
	test("drops a session id that carries shell metacharacters", () => {
		const hostileIds = [
			"x; echo pwned",
			"x$(echo pwned)",
			"x`echo pwned`",
			"x y",
			"x\necho pwned",
			"--dangerously-skip-permissions",
			"../../../etc/passwd",
			'x"y',
			"x'y",
		];

		for (const id of hostileIds) {
			const capture = createSessionCapture();
			capture.onStreamLine(JSON.stringify({ type: "task_started", taskId: id }));
			assert.equal(capture.sessionId(), undefined, `dirac accepted ${JSON.stringify(id)}`);

			const zcodeCapture = createSessionCapture();
			zcodeCapture.onStreamLine(JSON.stringify({ type: "session_id", sessionId: id }));
			assert.equal(
				zcodeCapture.sessionId(),
				undefined,
				`zcode accepted ${JSON.stringify(id)}`,
			);
		}
	});

	test("keeps the ids both backends actually emit", () => {
		for (const id of ["task-1", "1792827434130", "Ab_1.cd:ef", "A".repeat(128)]) {
			const capture = createSessionCapture();
			capture.onStreamLine(JSON.stringify({ type: "task_started", taskId: id }));
			assert.equal(capture.sessionId(), id);
		}

		// Over the length bound, and a value the alphabet cannot represent.
		for (const id of ["A".repeat(129), "Ab/cd"]) {
			const capture = createSessionCapture();
			capture.onStreamLine(JSON.stringify({ type: "task_started", taskId: id }));
			assert.equal(capture.sessionId(), undefined);
		}
	});
});

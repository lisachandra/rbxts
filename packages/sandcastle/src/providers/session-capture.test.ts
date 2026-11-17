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

	test("captures each upstream backend's announcement shape", () => {
		/*
		 * The three CLI backends do not share a shape, and none of them are dirac's or zcode's. Each
		 * line below is copied from the upstream provider that parses it, so a divergence there shows
		 * up here rather than as a silently empty store.
		 */
		const shapes: Array<{ backend: string; id: string; line: string }> = [
			// pi: `{"type":"session","id"}`.
			{ backend: "pi", id: "pi-1", line: '{"type":"session","id":"pi-1"}' },
			// codex: `{"type":"thread.started","thread_id"}`.
			{
				backend: "codex",
				id: "thread-1",
				line: '{"type":"thread.started","thread_id":"thread-1"}',
			},
			// claude-code: the init event carries `session_id`.
			{
				backend: "claude-code",
				id: "claude-1",
				line: '{"type":"system","subtype":"init","session_id":"claude-1"}',
			},
		];

		for (const { backend, id, line } of shapes) {
			const capture = createSessionCapture();
			capture.onStreamLine(line);
			assert.equal(capture.sessionId(), id, `${backend}'s announcement was not captured`);
		}
	});

	test("drops a hostile id from every upstream announcement shape", () => {
		// The shape a backend uses must not become a way around the token validation.
		const hostile = "x; echo pwned";
		const lines = [
			JSON.stringify({ type: "session", id: hostile }),
			JSON.stringify({ type: "thread.started", thread_id: hostile }),
			JSON.stringify({ type: "system", session_id: hostile, subtype: "init" }),
		];

		for (const line of lines) {
			const capture = createSessionCapture();
			capture.onStreamLine(line);
			assert.equal(capture.sessionId(), undefined, line);
		}
	});

	test("ignores an announcement that carries no usable id", () => {
		for (const line of [
			'{"type":"system","subtype":"init"}',
			'{"type":"session","id":42}',
			'{"type":"thread.started","thread_id":null}',
		]) {
			const capture = createSessionCapture();
			capture.onStreamLine(line);
			assert.equal(capture.sessionId(), undefined, line);
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

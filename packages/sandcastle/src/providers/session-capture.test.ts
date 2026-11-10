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
});

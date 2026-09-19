/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import type { AgentProvider } from "@ai-hero/sandcastle";

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import { withMarkerCompletion } from "./marker.js";

registerTestHooks();

const MARKER = "C:/sandcastle/markers/1.design.completed";
const PROTOCOL = '{"sandcastleMarker":"completed"}';

describe("withMarkerCompletion", () => {
	const inner: AgentProvider = {
		buildPrintCommand: ({ prompt }) => ({ command: "stub-cmd", stdin: prompt }),
		captureSessions: false,
		env: { FOO: "bar" },
		name: "stub",
		parseStreamLine: (line) => (line === "hello" ? [{ type: "text", text: "hi" }] : []),
	};

	test("wraps buildPrintCommand and merges marker env", () => {
		const wrapped = withMarkerCompletion(inner, MARKER);
		assert.equal(wrapped.name, "stub");
		assert.equal(wrapped.env.FOO, "bar");
		assert.equal(wrapped.env.SANDCASTLE_MARKER_COMPLETED, MARKER);

		const command = wrapped.buildPrintCommand({
			dangerouslySkipPermissions: false,
			prompt: "prompt",
		});
		assert.match(command.command, /agent-wrapper\.sh/);
		assert.match(command.command, /--stdin/);
		assert.match(command.command, /stub-cmd/);
		assert.equal(command.stdin, "prompt");
	});

	test("does not add --stdin for providers that embed the prompt in argv", () => {
		const argvInner: AgentProvider = {
			...inner,
			buildPrintCommand: () => ({ command: "agent --print prompt" }),
		};
		const wrapped = withMarkerCompletion(argvInner, MARKER);
		const command = wrapped.buildPrintCommand({
			dangerouslySkipPermissions: false,
			prompt: "prompt",
		});
		assert.doesNotMatch(command.command, /--stdin/);
	});

	test("flushes buffered output from the marker protocol line", () => {
		const wrapped = withMarkerCompletion(inner, MARKER);
		assert.deepEqual(wrapped.parseStreamLine("hello"), [{ type: "text", text: "hi" }]);

		const protocolEvents = wrapped.parseStreamLine(PROTOCOL);
		assert.equal(protocolEvents.length, 1);
		assert.equal(protocolEvents[0]?.type, "result");
		if (protocolEvents[0]?.type === "result") {
			assert.equal(protocolEvents[0].result, "hi");
		}

		assert.deepEqual(wrapped.parseStreamLine(PROTOCOL), []);
	});
});

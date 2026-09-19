/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { io } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";
import { claudeCodeProvider } from "./claude-code.js";
import { codexProvider } from "./codex.js";
import { copilotProvider } from "./copilot.js";
import { cursorProvider } from "./cursor.js";
import { opencodeProvider } from "./opencode.js";
import { piProvider } from "./pi.js";

registerTestHooks();

describe("provider adapters", () => {
	test("piProvider caps max effort to xhigh and disables session capture", () => {
		let received: undefined | { captureSessions: boolean; thinking: string };
		io.pi = ((_model: string, options?: { captureSessions?: boolean; thinking?: string }) => {
			received = options as { captureSessions: boolean; thinking: string };
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "pi:stub",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.pi;

		piProvider("m", "max");
		assert.deepEqual(received, { captureSessions: false, thinking: "xhigh" });
	});

	test("codexProvider caps max effort to xhigh and disables session capture", () => {
		let received: undefined | { captureSessions: boolean; effort: string };
		io.codex = ((_model: string, options?: { captureSessions?: boolean; effort?: string }) => {
			received = options as { captureSessions: boolean; effort: string };
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "codex:stub",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.codex;

		codexProvider("m", "xhigh");
		assert.deepEqual(received, { captureSessions: false, effort: "xhigh" });
	});

	test("copilotProvider maps effort to its supported range", () => {
		let receivedEffort: string | undefined;
		io.copilot = ((_model: string, options?: { effort?: string }) => {
			receivedEffort = options?.effort;
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "copilot",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.copilot;

		copilotProvider("m", "max");
		assert.equal(receivedEffort, "high");
		copilotProvider("m", "low");
		assert.equal(receivedEffort, "low");
	});

	test("cursorProvider and opencodeProvider ignore effort and pass empty args", () => {
		let cursorArgs: unknown;
		io.cursor = ((model: string, options: unknown) => {
			cursorArgs = { model, options };
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "cursor",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.cursor;

		cursorProvider("m", "max");
		assert.deepEqual(cursorArgs, { model: "m", options: {} });

		let opencodeArgs: unknown;
		io.opencode = ((model: string, options: unknown) => {
			opencodeArgs = { model, options };
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "opencode",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.opencode;

		opencodeProvider("m", "max");
		assert.deepEqual(opencodeArgs, { model: "m", options: {} });
	});

	test("claudeCodeProvider preserves max effort and disables session capture", () => {
		let received: undefined | { captureSessions: boolean; effort: string };
		io.claudeCode = ((
			_model: string,
			options?: { captureSessions?: boolean; effort?: string },
		) => {
			received = options as { captureSessions: boolean; effort: string };
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "claude-code:stub",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.claudeCode;

		claudeCodeProvider("m", "max");
		assert.deepEqual(received, { captureSessions: false, effort: "max" });
	});
});

import assert from "node:assert/strict";
import { describe, test } from "vitest";

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
	/*
	 * Session capture is left at upstream's default for the three backends that can resume.
	 * Disabling it was what kept their ids out of the store, so every retry started a fresh
	 * conversation exactly when the provider was flakiest. The assertion is "the option is absent",
	 * not "it is true": upstream defaults it to `true` for all three, and restating it here would
	 * make this file a second place that has to agree.
	 */
	test("piProvider caps max effort to xhigh and leaves session capture at upstream's default", () => {
		let received: undefined | { captureSessions?: boolean; thinking: string };
		io.pi = ((_model: string, options?: { captureSessions?: boolean; thinking?: string }) => {
			received = options as { captureSessions?: boolean; thinking: string };
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "pi:stub",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.pi;

		piProvider("m", "max");
		assert.deepEqual(received, { thinking: "xhigh" });
	});

	test("codexProvider caps max effort to xhigh and leaves session capture at upstream's default", () => {
		let received: undefined | { captureSessions?: boolean; effort: string };
		io.codex = ((_model: string, options?: { captureSessions?: boolean; effort?: string }) => {
			received = options as { captureSessions?: boolean; effort: string };
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "codex:stub",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.codex;

		codexProvider("m", "xhigh");
		assert.deepEqual(received, { effort: "xhigh" });
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

	test("claudeCodeProvider preserves max effort and leaves session capture at upstream's default", () => {
		let received: undefined | { captureSessions?: boolean; effort: string };
		io.claudeCode = ((
			_model: string,
			options?: { captureSessions?: boolean; effort?: string },
		) => {
			received = options as { captureSessions?: boolean; effort: string };
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "p" }),
				captureSessions: false,
				env: {},
				name: "claude-code:stub",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.claudeCode;

		claudeCodeProvider("m", "max");
		assert.deepEqual(received, { effort: "max" });
	});
});

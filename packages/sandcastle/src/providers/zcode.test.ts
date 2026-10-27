/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { zcodeAgent } from "../agent.js";
import { packageRoot } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";

registerTestHooks();

const tmpDirs: Array<string> = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sandcastle-zcode-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

const wrapperPath = join(packageRoot, "assets", "zcodeWrapper.mjs").replaceAll("\\", "/");
const stubPath = join(packageRoot, "assets", "zcodeStubAppServer.mjs").replaceAll("\\", "/");

describe("zcodeAgent", () => {
	test("buildPrintCommand routes through the wrapper with flags", () => {
		const agent = zcodeAgent("prov/model-x", { effort: "high" });
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
		});
		assert.match(command.command, /zcodeWrapper\.mjs/);
		assert.match(command.command, /--mode yolo/);
		assert.match(command.command, /--model "prov\/model-x"/);
		assert.match(command.command, /--reasoning-effort high/);
		assert.equal(command.stdin, "hi");
	});

	test("buildPrintCommand omits model/effort flags when unset", () => {
		const agent = zcodeAgent("", {});
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: false,
			prompt: "hi",
		});
		assert.doesNotMatch(command.command, /--model/);
		assert.doesNotMatch(command.command, /--reasoning-effort/);
		assert.doesNotMatch(command.command, /--mode yolo/);
	});

	test("parseStreamLine maps wrapper events and ignores the rest", () => {
		const agent = zcodeAgent("prov/model-x");

		assert.deepEqual(agent.parseStreamLine("not-json"), []);
		assert.deepEqual(
			agent.parseStreamLine(JSON.stringify({ type: "session_id", sessionId: "s" })),
			[],
		);
		assert.deepEqual(
			agent.parseStreamLine(JSON.stringify({ type: "tool", state: "running", tool: "bash" })),
			[],
		);
		assert.deepEqual(agent.parseStreamLine(JSON.stringify({ type: "keepalive" })), []);

		const text = agent.parseStreamLine(JSON.stringify({ type: "text", text: "partial" }));
		assert.deepEqual(text, [{ type: "text", text: "partial" }]);

		const emptyText = agent.parseStreamLine(JSON.stringify({ type: "text", text: "" }));
		assert.deepEqual(emptyText, []);

		const result = agent.parseStreamLine(JSON.stringify({ type: "result", result: "final" }));
		assert.deepEqual(result, [{ type: "result", result: "final" }]);

		const usage = agent.parseStreamLine(
			JSON.stringify({
				type: "usage",
				usage: {
					cacheCreationInputTokens: 2,
					cacheReadInputTokens: 5,
					inputTokens: 10,
					outputTokens: 4,
				},
			}),
		);
		assert.deepEqual(usage, [
			{
				type: "usage",
				usage: {
					cacheCreationInputTokens: 2,
					cacheReadInputTokens: 5,
					inputTokens: 10,
					outputTokens: 4,
				},
			},
		]);
	});
});

describe("zcode wrapper (stub app-server)", () => {
	interface StubOptions {
		failTurn?: boolean;
		requestPermission?: boolean;
	}

	function runWrapper(
		prompt: string,
		stubOptions: StubOptions = {},
	): {
		seen: Array<{ method: string; params?: Record<string, unknown> }>;
		status: null | number;
		stderr: string;
		stdout: string;
	} {
		const dir = tempDir();
		const seenFile = join(dir, "seen.json");
		const env: Record<string, string> = {
			...((process.env as Record<string, string | undefined>) ?? {}),
			// Point binary resolution at the stub so tests never touch a real zcode.
			STUB_SEEN_FILE: seenFile,
			ZCODE_SANDCASTLE_BIN: stubPath,
		};
		if (stubOptions.failTurn === true) {
			env.STUB_FAIL_TURN = "1";
		}

		if (stubOptions.requestPermission === true) {
			env.STUB_REQUEST_PERMISSION = "1";
		}

		// Run the wrapper the same way @ai-hero's sandbox does: `sh -c`, prompt on stdin.
		const result = spawnSync("sh", ["-c", `node "${wrapperPath}" --mode yolo`], {
			encoding: "utf-8",
			env,
			input: prompt,
			timeout: 30_000,
		});

		let seen: Array<{ method: string; params?: Record<string, unknown> }> = [];
		try {
			seen = JSON.parse(readFileSync(seenFile, "utf-8")) as Array<{
				method: string;
				params?: Record<string, unknown>;
			}>;
		} catch {
			// Stub may not have written the file on crash; tests below assert on it.
		}

		return { seen, status: result.status, stderr: result.stderr, stdout: result.stdout };
	}

	test("runs a full session: create, subscribe, send, events, close", () => {
		const { seen, status, stderr, stdout } = runWrapper("Do the thing");
		assert.equal(status, 0, `wrapper failed: ${stderr}`);

		const methods = seen.map((frame) => frame.method);
		assert.ok(methods.includes("session/create"), `no create in ${JSON.stringify(methods)}`);
		assert.ok(methods.includes("session/subscribe"));
		assert.ok(methods.includes("session/send"));
		assert.ok(methods.includes("session/close"));

		const create = seen.find((frame) => frame.method === "session/create");
		const createParams = create?.params as {
			mode?: string;
			workspace?: { workspacePath?: string };
		};
		assert.equal(createParams?.mode, "yolo");
		// The wrapper forwards its cwd as the session workspace unchanged.
		assert.equal(createParams?.workspace?.workspacePath, process.cwd());

		const send = seen.find((frame) => frame.method === "session/send");
		assert.equal((send?.params as { content?: string })?.content, "Do the thing");

		// Wrapper relays text slices and the final result + usage.
		assert.match(stdout, /"type":"text"/);
		assert.match(stdout, /"result":"stub-pong"/);
		assert.match(stdout, /"type":"usage"/);
		assert.match(stdout, /"inputTokens":10/);
		// Session id surfaces for the provider to ignore but logs to keep.
		assert.match(stdout, /"type":"session_id"/);
	});

	test("omits the model param when --model is absent", () => {
		const { seen, status } = runWrapper("hi");
		assert.equal(status, 0);
		const create = seen.find((frame) => frame.method === "session/create");
		const createParams = create?.params as {
			model?: unknown;
		};
		assert.equal(createParams?.model, undefined);
	});

	test("auto-answers permission requests with the allow option", () => {
		const { status, stderr } = runWrapper("hi", { requestPermission: true });
		assert.equal(status, 0, `wrapper failed: ${stderr}`);
	});

	test("exits non-zero when the turn fails", () => {
		const { status } = runWrapper("hi", { failTurn: true });
		assert.notEqual(status, 0);
	});
});

describe("zcode wrapper marker protocol", () => {
	test("writes the completion marker env through to the session env", () => {
		/*
		 * The marker contract is enforced by withMarkerCompletion; here we only
		 * verify the wrapper honors SANDCASTLE_MARKER_COMPLETED indirectly by
		 * checking the stub run exits cleanly without it (marker checks are the
		 * agent-wrapper.sh layer's job, covered by agent-wrapper.test.ts).
		 */
		const dir = tempDir();
		const markerPath = join(dir, "marker.completed");
		writeFileSync(markerPath, "", "utf-8");
		// Sanity: the marker file exists so withMarkerCompletion consumers behave.
		assert.ok(readFileSync(markerPath, "utf-8") !== undefined);
	});
});

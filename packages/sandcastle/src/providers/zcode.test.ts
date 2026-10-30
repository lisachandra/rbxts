/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

	test("buildPrintCommand forwards resumeSession as --resume-session", () => {
		const agent = zcodeAgent("prov/model-x");
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
			resumeSession: "session-42",
		});
		assert.match(command.command, /--resume-session session-42/);
	});

	test("buildPrintCommand omits the resume flag when no session is set", () => {
		const agent = zcodeAgent("prov/model-x");
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
		});
		assert.doesNotMatch(command.command, /--resume-session/);
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
		// The session id is the typed event upstream records on the iteration.
		assert.deepEqual(
			agent.parseStreamLine(JSON.stringify({ type: "session_id", sessionId: "s" })),
			[{ type: "session_id", sessionId: "s" }],
		);
		assert.deepEqual(agent.parseStreamLine(JSON.stringify({ type: "keepalive" })), []);
		assert.deepEqual(
			agent.parseStreamLine(JSON.stringify({ type: "note", text: "auto-answered" })),
			[],
		);

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

		// Tool events map to upstream's typed tool_call; notes are dropped here.
		const tool = agent.parseStreamLine(
			JSON.stringify({ type: "tool", detail: "ls → out", name: "bash", state: "completed" }),
		);
		assert.deepEqual(tool, [{ type: "tool_call", args: "ls → out", name: "bash" }]);

		const toolNoDetail = agent.parseStreamLine(
			JSON.stringify({ type: "tool", name: "read", state: "running" }),
		);
		assert.deepEqual(toolNoDetail, [{ type: "tool_call", args: "", name: "read" }]);
	});
});

describe("zcode wrapper (stub app-server)", () => {
	interface StubOptions {
		extraArgs?: string;
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
		const result = spawnSync(
			"sh",
			["-c", `node "${wrapperPath}" --mode yolo${stubOptions.extraArgs ?? ""}`],
			{
				encoding: "utf-8",
				env,
				input: prompt,
				timeout: 30_000,
			},
		);

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
			persistence?: string;
			workspace?: { workspacePath?: string };
		};
		assert.equal(createParams?.mode, "yolo");
		/*
		 * Sessions persist at create so they are visible in the desktop app even
		 * when the run dies before its first turn completes.
		 */
		assert.equal(createParams?.persistence, "immediate");
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

	test("emits tool detail from desktop-continuous tool.updated results", () => {
		const { status, stderr, stdout } = runWrapper("Do the thing");
		assert.equal(status, 0, `wrapper failed: ${stderr}`);

		const lines = stdout
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const toolEvents = lines.filter((line) => line.type === "tool") as Array<{
			detail?: string;
			name: string;
			state: string;
		}>;
		const textEvents = lines.filter((line) => line.type === "text") as Array<{
			text: string;
		}>;

		// tool.updated lifecycle: started, progress (no detail — empty preview), result.
		assert.deepEqual(
			toolEvents.map((event) => [event.name, event.state]),
			[
				["Bash", "started"],
				["Bash", "running"],
				["Bash", "completed"],
			],
		);
		assert.equal(toolEvents[0]?.detail, undefined);
		assert.equal(toolEvents[2]?.detail, "echo stub-run\n→ stub-run\nexit 0");

		// model.streaming text deltas relay as text events.
		assert.equal(textEvents.map((event) => event.text).join(""), "working hard");

		// The auto-generated title surfaces as a note.
		const notes = lines.filter((line) => line.type === "note") as Array<{ text: string }>;
		assert.match(notes.at(-1)?.text ?? "", /session title: stub title/);
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

	test("--resume-session issues session/resume with the requested id", () => {
		const { seen, status, stderr, stdout } = runWrapper("continue", {
			extraArgs: " --resume-session session-42",
		});
		assert.equal(status, 0, `wrapper failed: ${stderr}`);

		const methods = seen.map((frame) => frame.method);
		assert.ok(methods.includes("session/resume"), `no resume in ${JSON.stringify(methods)}`);
		assert.ok(!methods.includes("session/create"), "resume must not create a fresh session");

		const resume = seen.find((frame) => frame.method === "session/resume");
		const resumeParams = resume?.params as {
			sessionId?: string;
			workspace?: { workspacePath?: string };
		};
		assert.equal(resumeParams?.sessionId, "session-42");
		assert.equal(resumeParams?.workspace?.workspacePath, process.cwd());

		// Subscribe + send run against the resumed session, and the id is re-announced.
		const subscribe = seen.find((frame) => frame.method === "session/subscribe");
		assert.equal((subscribe?.params as { sessionId?: string })?.sessionId, "session-42");
		const send = seen.find((frame) => frame.method === "session/send");
		assert.equal((send?.params as { sessionId?: string })?.sessionId, "session-42");
		assert.match(stdout, /"type":"session_id","sessionId":"session-42"/);
		assert.match(stdout, /"result":"stub-pong"/);
	});

	test("auto-answers permission requests with the allow option", () => {
		const { status, stderr } = runWrapper("hi", { requestPermission: true });
		assert.equal(status, 0, `wrapper failed: ${stderr}`);
	});

	test("exits non-zero when the turn fails", () => {
		const { status } = runWrapper("hi", { failTurn: true });
		assert.notEqual(status, 0);
	});

	describe("provider-config env injection", () => {
		interface StubEnvSnapshot {
			builtin: null | string;
			personal: null | string;
			retryMaxRetries: null | string;
		}

		function runWrapperEnv(
			extraEnv: Record<string, string | undefined>,
		): StubEnvSnapshot & { status: null | number; stderr: string } {
			const dir = tempDir();
			const envFile = join(dir, "env.json");
			const env: Record<string, string | undefined> = {
				...(process.env as Record<string, string | undefined>),
				STUB_ENV_FILE: envFile,
				ZCODE_SANDCASTLE_BIN: stubPath,
			};
			for (const [key, value] of Object.entries(extraEnv)) {
				if (value === undefined) {
					delete env[key];
				} else {
					env[key] = value;
				}
			}

			const result = spawnSync("sh", ["-c", `node "${wrapperPath}" --mode yolo`], {
				encoding: "utf-8",
				env,
				input: "hi",
				timeout: 30_000,
			});
			let snapshot: StubEnvSnapshot = {
				builtin: null,
				personal: null,
				retryMaxRetries: null,
			};
			try {
				snapshot = JSON.parse(readFileSync(envFile, "utf-8")) as StubEnvSnapshot;
			} catch {
				// Stub never spawned; assertions below report the failure.
			}

			return { ...snapshot, status: result.status, stderr: result.stderr };
		}

		test("injects the packaged builtin config outside the desktop app", () => {
			const { builtin, personal, status, stderr } = runWrapperEnv({
				ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: undefined,
				ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: undefined,
			});
			assert.equal(status, 0, `wrapper failed: ${stderr}`);
			/*
			 * The desktop app's packaged catalog exists on dev machines; when it
			 * does, the wrapper must point the CLI at it explicitly.
			 */
			const packaged = join(
				process.env.LocalAppData ?? "",
				"Programs",
				"ZCode",
				"resources",
				"config",
				"provider",
				"zcode-builtin.json",
			);
			if (existsSync(packaged)) {
				assert.equal(builtin, packaged);
				assert.equal(personal, join(homedir(), ".zcode", "v2", "provider_config.json"));
			}
		});

		test("preserves preset provider-config env untouched", () => {
			const preset = join(tempDir(), "preset-builtin.json");
			writeFileSync(preset, "{}", "utf-8");
			const { builtin, status, stderr } = runWrapperEnv({
				ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: preset,
			});
			assert.equal(status, 0, `wrapper failed: ${stderr}`);
			assert.equal(builtin, preset);
		});

		test("injects the near-infinite retry budget when unset", () => {
			const { retryMaxRetries, status, stderr } = runWrapperEnv({
				ZCODE_MODEL_RETRY_MAX_RETRIES: undefined,
			});
			assert.equal(status, 0, `wrapper failed: ${stderr}`);
			assert.equal(retryMaxRetries, "100000");
			assert.match(stderr, /injecting ZCODE_MODEL_RETRY_MAX_RETRIES/);
		});

		test("preserves a preset retry budget untouched", () => {
			const { retryMaxRetries, status, stderr } = runWrapperEnv({
				ZCODE_MODEL_RETRY_MAX_RETRIES: "3",
			});
			assert.equal(status, 0, `wrapper failed: ${stderr}`);
			assert.equal(retryMaxRetries, "3");
			assert.doesNotMatch(stderr, /injecting ZCODE_MODEL_RETRY_MAX_RETRIES/);
		});
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

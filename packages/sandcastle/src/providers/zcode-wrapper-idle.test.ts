/*
 * End-to-end proof for the 600s AgentIdleTimeoutError starvation behind the
 * design-phase failures (e.g. rocket-powered-blox-cars #174, design attempt 1).
 *
 * Upstream @ai-hero/sandcastle resets a 600s idle watchdog on EVERY stdout
 * line from the agent process (invokeAgent's onLine → resetTimer) and fails
 * the phase when no line arrives within idleTimeoutSeconds — the zcode
 * process being alive and thinking changes nothing. The wrapper bridges the
 * ZCode Protocol to that stdout and deliberately drops reasoning deltas from
 * stdout, so the invariant that keeps long thinking phases alive is: only
 * stdout-producing protocol events may re-arm the wrapper's keep-alive
 * heartbeat.
 *
 * These tests spawn the real zcodeWrapper.mjs against the stub app-server and
 * observe its stdout the way upstream does: a gap between consecutive stdout
 * lines larger than the watchdog means upstream would have fired
 * AgentIdleTimeoutError at that point. No real zcode binary and no model
 * calls are involved — the stub streams synthetic reasoning deltas.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "vitest";

import { packageRoot } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";

registerTestHooks();

const tmpDirs: Array<string> = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sandcastle-wrapper-idle-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

const wrapperPath = join(packageRoot, "assets", "zcodeWrapper.mjs");
const stubPath = join(packageRoot, "assets", "zcodeStubAppServer.mjs");

/** Length of the stub's pure-thinking window (continuous reasoning deltas). */
const REASONING_DURATION_MS = 7000;
/** Cadence of the stub's reasoning deltas — faster than any timer below. */
const REASONING_INTERVAL_MS = 200;
/**
 * Compressed stand-in for upstream's 600s idle watchdog. A stdout gap larger than this is exactly
 * the condition under which upstream's resetTimer fiber completes its sleep and fails the phase
 * with AgentIdleTimeoutError.
 */
const WATCHDOG_MS = 3000;

interface WrapperEvent {
	type: string;
	[key: string]: unknown;
}

interface WatchResult {
	code: null | number;
	events: Array<WrapperEvent>;
	/** Largest gap between consecutive stdout lines, including spawn → first line. */
	maxGapMs: number;
	seen: Array<{ method: string; params?: Record<string, unknown> }>;
	stderr: string;
}

/*
 * Runs the real wrapper against the stub app-server and records its stdout
 * the way upstream's invokeAgent does: every line resets the watchdog, and
 * the largest inter-line gap is the idle stretch upstream would have judged.
 */
function runWrapperUnderWatchdog(options: {
	extraEnv?: Record<string, string>;
	prompt: string;
	reasoning?: boolean;
}): Promise<WatchResult> {
	return new Promise((resolve, reject) => {
		const dir = tempDir();
		const seenFile = join(dir, "seen.json");
		const child = spawn(process.execPath, [wrapperPath, "--mode", "yolo"], {
			env: {
				...((process.env as Record<string, string | undefined>) ?? {}),
				...(options.reasoning === true
					? {
							STUB_REASONING_DURATION_MS: String(REASONING_DURATION_MS),
							STUB_REASONING_INTERVAL_MS: String(REASONING_INTERVAL_MS),
							STUB_REASONING_ONLY: "1",
						}
					: {}),
				...options.extraEnv,
				// Point binary resolution at the stub so tests never touch a real zcode.
				STUB_SEEN_FILE: seenFile,
				ZCODE_SANDCASTLE_BIN: stubPath,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		const events: Array<WrapperEvent> = [];
		let buffer = "";
		let lastLineAt = Date.now();
		let maxGapMs = 0;
		let stderr = "";
		let settled = false;

		const finish = (code: null | number, error?: Error) => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(overallTimer);
			let seen: Array<{ method: string; params?: Record<string, unknown> }> = [];
			try {
				seen = JSON.parse(readFileSync(seenFile, "utf-8")) as Array<{
					method: string;
					params?: Record<string, unknown>;
				}>;
			} catch {
				// Assertions below report the missing stub frames.
			}

			if (error !== undefined) {
				child.kill();
				reject(error);
				return;
			}

			resolve({ code, events, maxGapMs, seen, stderr });
		};

		// Guard so a broken wrapper can never hang the suite.
		const overallTimer = setTimeout(() => {
			finish(null, new Error(`wrapper did not exit within 30s; stderr:\n${stderr}`));
		}, 30_000);

		child.stdout.setEncoding("utf-8");
		child.stdout.on("data", (chunk: string) => {
			buffer += chunk;
			let newlineAt = buffer.indexOf("\n");
			while (newlineAt !== -1) {
				const line = buffer.slice(0, newlineAt).trim();
				buffer = buffer.slice(newlineAt + 1);
				if (line !== "") {
					// Upstream calls resetTimer() on every raw line, before parsing.
					const now = Date.now();
					maxGapMs = Math.max(maxGapMs, now - lastLineAt);
					lastLineAt = now;
					try {
						events.push(JSON.parse(line) as WrapperEvent);
					} catch {
						// Non-JSON stdout still resets upstream's timer; nothing to parse.
					}
				}

				newlineAt = buffer.indexOf("\n");
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			finish(null, error);
		});
		child.on("close", (code) => {
			finish(code);
		});

		child.stdin.write(options.prompt);
		child.stdin.end();
	});
}

describe("zcode wrapper idle watchdog (e2e)", () => {
	test("a pure-thinking stream starves stdout: no keep-alives, a gap upstream's watchdog kills", async () => {
		/*
		 * Production failure signature (#174 design attempt 1): the model thinks
		 * in an unbroken reasoning_delta stream — protocol events keep arriving,
		 * so the run looks alive — but nothing reaches stdout, and upstream's
		 * watchdog fires mid-thought. Uses the production 120s heartbeat, so a
		 * 7s thinking window emits no keep-alive either way: this test pins the
		 * starvation mechanism and stays green across the heartbeat fix (the
		 * fix pays off when thinking outlasts the heartbeat — proven below).
		 */
		const { code, events, maxGapMs, stderr } = await runWrapperUnderWatchdog({
			prompt: "Design the plan",
			reasoning: true,
		});
		assert.equal(code, 0, `wrapper failed: ${stderr}`);

		// The agent side was healthy: the thinking turn completed normally.
		const results = events.filter((event) => event.type === "result");
		assert.equal(
			results.length,
			1,
			`expected exactly one result event: ${JSON.stringify(events)}`,
		);
		assert.equal(results[0]?.result, "thinking-done");

		// Zero stdout during the whole thinking window — #174 run 1's signature.
		const keepAlives = events.filter((event) => event.type === "keep-alive");
		assert.deepEqual(keepAlives, [], "no keep-alive may fire during a reasoning stream");

		// A stdout gap beyond the watchdog is where upstream kills the phase.
		assert.ok(
			maxGapMs > WATCHDOG_MS,
			`expected a stdout gap > ${WATCHDOG_MS}ms (AgentIdleTimeoutError territory), got ${maxGapMs}ms`,
		);
	});

	test("with a fast heartbeat, keep-alives flow during thinking and the watchdog never fires", async () => {
		/*
		 * The fix proof: only stdout-producing events may re-arm the heartbeat.
		 * Before the fix, reasoning deltas re-armed the (env-tunable) heartbeat
		 * every 200ms and NO keep-alive could ever fire — the stdout gap spanned
		 * the entire thinking window and the watchdog fired. After the fix, the
		 * heartbeat ignores reasoning deltas and keep-alives reach upstream
		 * every 300ms, keeping the phase alive through arbitrarily long thinking.
		 */
		const { code, events, maxGapMs, stderr } = await runWrapperUnderWatchdog({
			extraEnv: { ZCODE_SANDCASTLE_HEARTBEAT_MS: "300" },
			prompt: "Design the plan",
			reasoning: true,
		});
		assert.equal(code, 0, `wrapper failed: ${stderr}`);

		const keepAlives = events.filter((event) => event.type === "keep-alive");
		assert.ok(
			keepAlives.length >= 5,
			`expected keep-alives during the ${REASONING_DURATION_MS}ms thinking window, got ${keepAlives.length}`,
		);

		// Upstream's watchdog never comes close to firing.
		assert.ok(
			maxGapMs <= WATCHDOG_MS,
			`expected every stdout gap ≤ ${WATCHDOG_MS}ms, got ${maxGapMs}ms — upstream would have fired AgentIdleTimeoutError`,
		);

		// The thinking turn still completes and delivers its result.
		const results = events.filter((event) => event.type === "result");
		assert.equal(results.length, 1);
		assert.equal(results[0]?.result, "thinking-done");
	});

	test("a /goal prompt prefix passes through to session/send verbatim", () => {
		/*
		 * Sandcastle's zcode path is the app-server protocol, not `zcode -p`:
		 * only the -p driver parses slash commands, so a "/goal …" prefix on the
		 * prompt is model-visible plain text here — it cannot activate zcode's
		 * goal system, let alone fix the idle watchdog. Byte-identity of the
		 * delivered content pins that.
		 */
		const prompt = "/goal Design a plan for issue #174";
		const dir = tempDir();
		const seenFile = join(dir, "seen.json");
		const result = spawnSync(process.execPath, [wrapperPath, "--mode", "yolo"], {
			encoding: "utf-8",
			env: {
				...((process.env as Record<string, string | undefined>) ?? {}),
				STUB_SEEN_FILE: seenFile,
				ZCODE_SANDCASTLE_BIN: stubPath,
			},
			input: prompt,
			timeout: 30_000,
		});
		assert.equal(result.status, 0, `wrapper failed: ${result.stderr}`);

		const seen = JSON.parse(readFileSync(seenFile, "utf-8")) as Array<{
			method: string;
			params?: Record<string, unknown>;
		}>;
		// No goal-protocol call exists on this path — the prefix is inert.
		assert.ok(
			!seen.some((frame) => frame.method === "session/goal"),
			"the wrapper must not interpret prompt slash commands",
		);
		const send = seen.find((frame) => frame.method === "session/send");
		assert.equal(
			(send?.params as { content?: string })?.content,
			prompt,
			"/goal prefix must reach the model as plain prompt text, uninterpreted",
		);
	});
});

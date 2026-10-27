#!/usr/bin/env node
/*
 * Sandcastle zcode wrapper.
 *
 * Bridges the ZCode Protocol (`zcode app-server`, newline-delimited JSON over
 * stdio) to the flat JSONL event stream @ai-hero/sandcastle expects from a
 * provider. The prompt arrives on stdin; flags after argv control the session:
 *
 *   --mode <mode>              permission mode: yolo (default) or build
 *   --model <providerId/modelId>  model selection; omitted uses zcode's default
 *   --reasoning-effort <level> thought level; forwarded per-session
 *
 * Binary resolution order: $ZCODE_SANDCASTLE_BIN, `zcode` on PATH, then the
 * ZCode desktop app's bundled CLI. Events are emitted as one JSON object per
 * line: {type:"text"|"tool"|"result"|"usage"|"keepalive"}. The final
 * turn.completed response becomes the single `result` event. Unknown lines
 * (non-JSON, stderr noise) are ignored by the provider's parser.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

const RUNTIME_PREFERENCES = {
	askUserQuestionAutoResolutionEnabled: true,
	memoryEnabled: false,
	modelContextBudgetStrategy: "preflight-v1",
	nativeSearchEnhancementsEnabled: false,
};
const DELIVERY_KIND = "desktop-continuous";
const REQUEST_TIMEOUT_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 120_000;

function parseArgs(argv) {
	const args = { effort: "", mode: "yolo", model: "" };
	for (let index = 0; index < argv.length; index++) {
		const value = argv[index + 1] ?? "";
		if (value === "") {
			continue;
		}

		switch (argv[index]) {
			case "--mode": {
				args.mode = value;
				index++;

				break;
			}
			case "--model": {
				args.model = value;
				index++;

				break;
			}
			case "--reasoning-effort": {
				args.effort = value;
				index++;

				break;
			}
			// No default
		}
	}

	return args;
}

function resolveBinary() {
	const override = process.env.ZCODE_SANDCASTLE_BIN?.trim();
	if (override !== undefined && override !== "" && existsSync(override)) {
		return override;
	}

	const isWindows = process.platform === "win32";
	const extensions = isWindows ? [".exe", ".cjs", ".cmd", ""] : [""];
	for (const dir of (process.env.PATH ?? "").split(isWindows ? ";" : ":")) {
		if (dir === "") {
			continue;
		}

		for (const extension of extensions) {
			const candidate = `${dir}${isWindows ? "\\" : "/"}zcode${extension}`;
			if (existsSync(candidate)) {
				return candidate;
			}
		}
	}

	const localAppData = process.env.LocalAppData ?? "";
	const candidates =
		isWindows && localAppData !== ""
			? [`${localAppData}\\Programs\\ZCode\\resources\\glm\\zcode.cjs`]
			: process.platform === "darwin"
				? ["/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"]
				: ["/opt/ZCode/resources/glm/zcode.cjs", "/usr/lib/zcode/resources/glm/zcode.cjs"];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

function spawnServer(binary) {
	const isWindows = process.platform === "win32";
	const isScript = /\.(cjs|mjs|js)$/i.test(binary);
	const isShellShim = isWindows && /\.cmd$/i.test(binary);
	if (isScript) {
		return spawn(process.execPath, [binary, "app-server"], {
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	if (isShellShim) {
		return spawn("cmd.exe", ["/c", binary, "app-server"], {
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	return spawn(binary, ["app-server"], {
		env: process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function emit(event) {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitNote(message) {
	process.stderr.write(`zcode-wrapper: ${message}\n`);
}

const args = parseArgs(process.argv.slice(2));
const binary = resolveBinary();
if (binary === undefined) {
	emitNote(
		"zcode binary not found. Set ZCODE_SANDCASTLE_BIN to the CLI entry (e.g. the desktop bundle zcode.cjs), install zcode on PATH, or install the ZCode desktop app.",
	);
	process.exit(1);
}

const child = spawnServer(binary);
const stderrTail = [];
child.stderr.on("data", (chunk) => {
	stderrTail.push(String(chunk));
	if (stderrTail.length > 32) {
		stderrTail.shift();
	}
});
child.on("exit", (code, signal) => {
	if (!finished) {
		emitNote(
			`zcode app-server exited early (code=${code ?? "null"} signal=${signal ?? "null"})`,
		);
		dumpStderrTail();
		process.exit(1);
	}
});

function dumpStderrTail() {
	const tail = stderrTail.join("").trim();
	if (tail !== "") {
		emitNote(`--- zcode stderr (last ${stderrTail.length} chunks) ---\n${tail.slice(-8_000)}`);
	}
}

let nextRequestId = 0;
const pendingRequests = new Map();
function writeFrame(frame) {
	child.stdin.write(`${JSON.stringify(frame)}\n`);
}

function respond(id, result) {
	writeFrame({ id, result });
}

function request(method, parameters, timeoutMs = REQUEST_TIMEOUT_MS) {
	const id = ++nextRequestId;
	writeFrame({ id, method, params: parameters });
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`zcode request timed out after ${timeoutMs}ms: ${method}`));
		}, timeoutMs);
		pendingRequests.set(id, {
			method,
			reject: (error) => {
				clearTimeout(timer);
				reject(error);
			},
			resolve: (value) => {
				clearTimeout(timer);
				resolve(value);
			},
		});
	});
}

function handleServerRequest(frame) {
	const { id, method, params } = frame;
	if (method === "session/requestRuntimePreferences") {
		respond(id, RUNTIME_PREFERENCES);
		return;
	}

	if (method === "interaction/requestOfficialMcpAuthHeaders") {
		respond(id, { error: { code: -32601, message: "Unsupported" } });
		return;
	}

	if (method === "interaction/requestPermission") {
		const options = Array.isArray(params?.options) ? params.options : [];
		const allow = options.find((option) => option?.response?.decision === "allow");
		emitNote(
			`auto-answered permission for ${params?.toolName ?? "unknown tool"} (risk ${params?.riskLevel ?? "?"})`,
		);
		respond(
			id,
			allow?.response ?? {
				decision: "deny",
				reason: "zcode-wrapper: no allow option offered",
			},
		);
		return;
	}

	if (method === "interaction/requestUserInput") {
		emitNote("auto-cancelled user input request (headless run)");
		respond(id, { cancelled: true, value: "" });
		return;
	}

	respond(id, {});
}

let finished = false;
let turnError;
let resolveTurn;
const turnSettledPromise = new Promise((resolve) => {
	resolveTurn = (error) => {
		turnError = error;
		resolve(error);
	};
});

/** Resolves the pending turn exactly once; later terminal events are ignored. */
function settleTurn(error) {
	if (resolveTurn === undefined) {
		return;
	}

	const settle = resolveTurn;
	resolveTurn = undefined;
	settle(error);
}

/** PartId → next slice offset already emitted as a text event. */
const emittedTextLengths = new Map();
let lastToolEventKey = "";
let keepaliveTimer;
function markActivity() {
	if (keepaliveTimer !== undefined) {
		clearInterval(keepaliveTimer);
	}

	keepaliveTimer = setInterval(() => {
		emit({ type: "keep-alive" });
	}, HEARTBEAT_INTERVAL_MS);
	keepaliveTimer.unref?.();
}

function emitTextSlice(partId, fullText) {
	const emitted = emittedTextLengths.get(partId) ?? 0;
	if (fullText.length <= emitted) {
		emittedTextLengths.set(partId, Math.min(emitted, fullText.length));
		return;
	}

	const slice = fullText.slice(emitted);
	emittedTextLengths.set(partId, fullText.length);
	markActivity();
	emit({ type: "text", text: slice });
}

function handleSessionEvent(parameters) {
	const { type, payload } = parameters;
	if (type === "turn.completed") {
		markActivity();
		const usage = payload?.usage ?? {};
		emit({ type: "result", result: String(payload?.response ?? "") });
		emit({
			type: "usage",
			usage: {
				cacheCreationInputTokens: Number(usage.cacheWriteTokens ?? 0),
				cacheReadInputTokens: Number(usage.cacheReadTokens ?? 0),
				inputTokens: Number(usage.inputTokens ?? 0),
				outputTokens: Number(usage.outputTokens ?? 0),
			},
		});
		settleTurn(undefined);
		return;
	}

	if (type === "turn.failed") {
		settleTurn(
			new Error(
				`zcode turn failed: ${payload?.error?.message ?? JSON.stringify(payload?.error ?? payload)}`,
			),
		);
		return;
	}

	if (type === "part.started" || type === "part.upserted") {
		const part = payload?.part;
		if (part?.type === "text") {
			emitTextSlice(String(part.partId), String(part.text ?? ""));
			return;
		}

		if (part?.type === "tool") {
			const key = `${part.tool}:${part.state?.status ?? ""}`;
			if (key !== lastToolEventKey) {
				lastToolEventKey = key;
				markActivity();
				emit({
					type: "tool",
					name: String(part.tool),
					state: String(part.state?.status ?? "unknown"),
				});
			}
		}

		// reasoning parts are dropped (matches the dirac provider's isReasoning filter)
		return;
	}

	if (type === "part.delta") {
		// Deltas are folded into the next part.upserted snapshot; nothing to do.
	}
}

const stdout = createInterface({ input: child.stdout });
stdout.on("line", (line) => {
	const trimmed = line.trim();
	if (trimmed === "") {
		return;
	}

	let frame;
	try {
		frame = JSON.parse(trimmed);
	} catch {
		return;
	}

	if (frame.id !== undefined && (frame.result !== undefined || frame.error !== undefined)) {
		const pending = pendingRequests.get(frame.id);
		if (pending === undefined) {
			return;
		}

		pendingRequests.delete(frame.id);
		if (frame.error !== undefined) {
			pending.reject(
				new Error(
					`${pending.method}: ${frame.error.message ?? JSON.stringify(frame.error)}`,
				),
			);
		} else {
			pending.resolve(frame.result);
		}

		return;
	}

	if (frame.method !== undefined && frame.id !== undefined) {
		handleServerRequest(frame);
		return;
	}

	if (frame.method === "session/event") {
		handleSessionEvent(frame.params ?? {});
	}
});

async function shutdown(sessionId) {
	finished = true;
	if (keepaliveTimer !== undefined) {
		clearInterval(keepaliveTimer);
	}

	if (sessionId !== undefined) {
		try {
			await request("session/close", { sessionId }, 10_000);
		} catch {
			// Best-effort; the child is killed below regardless.
		}
	}

	child.stdin.end();
	setTimeout(() => {
		try {
			child.kill();
		} catch {
			// Already gone.
		}

		setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// Nothing left to do.
			}

			process.exit(0);
		}, 1_000);
	}, 100);
}

function fail(message) {
	emitNote(message);
	dumpStderrTail();
	finished = true;
	child.kill();
	process.exit(1);
}

child.on("error", (error) => {
	fail(`failed to spawn zcode (${binary}): ${error.message}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		emitNote(`received ${signal}; aborting session`);
		process.exit(130);
	});
}

const prompt = await new Promise((resolve, reject) => {
	let data = "";
	process.stdin.setEncoding("utf-8");
	process.stdin.on("data", (chunk) => {
		data += chunk;
	});
	process.stdin.on("end", () => {
		resolve(data);
	});
	process.stdin.on("error", reject);
});

const cwd = process.cwd();
const [providerId, ...modelIdParts] = args.model.split("/");
const hasExplicitModel =
	args.model !== "" && providerId !== "" && modelIdParts.join("/").trim() !== "";

let created;
try {
	created = await request(
		"session/create",
		{
			mode: args.mode,
			persistence: "deferred",
			titleGenerationEnabled: false,
			workspace: { workspaceKey: cwd, workspacePath: cwd },
			...(hasExplicitModel
				? {
						model: {
							modelId: modelIdParts.join("/"),
							providerId,
							...(args.effort !== ""
								? { options: { reasoningLevel: args.effort } }
								: {}),
						},
					}
				: {}),
			/*
			 * session/create flattens model.options after bootstrap validation
			 * (setModel receives "providerId/modelId"), so the thought level must
			 * also be re-applied top-level or level-required models fail their
			 * first turn with "Reasoning level is required".
			 */
			...(hasExplicitModel && args.effort !== "" ? { thoughtLevel: args.effort } : {}),
		},
		120_000,
	);
} catch (err) {
	fail(`session/create failed: ${err.message}`);
}

const sessionId = created?.session?.sessionId;
if (sessionId === undefined || sessionId === "") {
	fail(`session/create returned no sessionId: ${JSON.stringify(created)?.slice(0, 400)}`);
}

emit({ type: "session_id", sessionId });

try {
	await request("session/subscribe", { deliveryKind: DELIVERY_KIND, sessionId }, 15_000);
} catch (err) {
	fail(`session/subscribe failed: ${err.message}`);
}

markActivity();
try {
	await request("session/send", { content: prompt, sessionId }, 30_000);
} catch (err) {
	await shutdown(sessionId);
	fail(`session/send failed: ${err.message}`);
}

await turnSettledPromise;
await shutdown(sessionId);

if (turnError !== undefined) {
	fail(turnError.message);
}

process.exit(0);

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
 *   --resume-session <id>      resume a persisted session instead of creating one
 *
 * Binary resolution order: $ZCODE_SANDCASTLE_BIN, `zcode` on PATH, then the
 * ZCode desktop app's bundled CLI. Outside the desktop app the CLI cannot
 * locate its built-in provider catalog, so the wrapper injects
 * ZCODE_BUILTIN_PROVIDER_CONFIG_FILE (plus ZCODE_PERSONAL_PROVIDER_CONFIG_FILE
 * when resolvable) before spawning; preset values pass through untouched.
 * Events are emitted as one JSON object per line:
 * {type:"text"|"tool"|"note"|"result"|"usage"|"keepalive"}. In
 * desktop-continuous delivery the app-server streams model.streaming deltas
 * (text_delta / tool_input_*) and tool.updated lifecycle events
 * (scheduled/started/progress/result) — the result kind carries the command,
 * exit code and output preview, which the wrapper folds into the tool
 * event's `detail` for digest parity with dirac's cards. The final
 * turn.completed response becomes the single `result` event. Unknown lines
 * (non-JSON, stderr noise) are ignored by the provider's parser.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
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
	const args = { effort: "", mode: "yolo", model: "", resumeSession: "" };
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
			case "--resume-session": {
				args.resumeSession = value;
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

/*
 * ZCode's bundled CLI resolves its built-in provider catalog relative to its
 * own entrypoint (entry_dir/provider/zcode-builtin.json, then entry_dir/../
 * config/provider/zcode-builtin.json) and aborts at startup when neither
 * exists — the ZCode desktop app normally injects these paths via env, which
 * is why running `zcode app-server` from a bare shell fails. Mirror the
 * desktop app here: use preset env values when set, otherwise fall back to
 * the desktop install's packaged catalog and ~/.zcode/v2/provider_config.json.
 */
function findPackagedBuiltinConfig() {
	const isWindows = process.platform === "win32";
	const localAppData = process.env.LocalAppData ?? "";
	const candidates =
		isWindows && localAppData !== ""
			? [path.join(localAppData, "Programs", "ZCode", "resources", "config", "provider")]
			: process.platform === "darwin"
				? ["/Applications/ZCode.app/Contents/Resources/config/provider"]
				: [
						"/opt/ZCode/resources/config/provider",
						"/usr/lib/zcode/resources/config/provider",
					];
	for (const directory of candidates) {
		const candidate = path.join(directory, "zcode-builtin.json");
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

function resolveProviderConfigEnv() {
	const env = {};
	const builtinKey = "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE";
	const personalKey = "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE";
	const envPath = (key) => (process.env[key] ?? "").trim();
	const builtinPreset = envPath(builtinKey) !== "";
	const personalPreset = envPath(personalKey) !== "";
	if (builtinPreset && personalPreset) {
		return env; // The CLI resolves everything from env; nothing to inject.
	}

	if (!builtinPreset) {
		const packaged = findPackagedBuiltinConfig();
		if (packaged === undefined) {
			emitNoteOnce(
				"ZCODE_BUILTIN_PROVIDER_CONFIG_FILE unset and no desktop install found; " +
					"relying on zcode's own lookup",
			);
			return env;
		}

		env[builtinKey] = packaged;
	}

	if (!personalPreset) {
		const personal = path.join(homedir(), ".zcode", "v2", "provider_config.json");
		if (existsSync(personal)) {
			env[personalKey] = personal;
		}
	}

	return env;
}

let providerConfigNoteEmitted = false;
function emitNoteOnce(message) {
	if (providerConfigNoteEmitted) {
		return;
	}

	providerConfigNoteEmitted = true;
	emitNote(message);
}

/*
 * Zcode gives up on a model request after 10 retries (~11 attempts, capped
 * 2s..60s backoff). A flaky provider endpoint (HTTP 5xx, connection resets)
 * then fails the whole sandcastle phase. Retry effectively forever unless the
 * caller preset ZCODE_MODEL_RETRY_MAX_RETRIES: at the 60s backoff cap the
 * budget spans years, and zcode still honors Retry-After for rate limits.
 */
const DEFAULT_RETRY_BUDGET = "100000";
function resolveRetryEnv() {
	const key = "ZCODE_MODEL_RETRY_MAX_RETRIES";
	const preset = (process.env[key] ?? "").trim();
	if (preset !== "") {
		return {};
	}

	emitNote(`injecting ${key}=${DEFAULT_RETRY_BUDGET} (set the env to override)`);
	return { [key]: DEFAULT_RETRY_BUDGET };
}

function spawnServer(binary) {
	const isWindows = process.platform === "win32";
	const isScript = /\.(cjs|mjs|js)$/i.test(binary);
	const isShellShim = isWindows && /\.cmd$/i.test(binary);
	const childEnv = { ...process.env, ...resolveProviderConfigEnv(), ...resolveRetryEnv() };
	if (isScript) {
		return spawn(process.execPath, [binary, "app-server"], {
			env: childEnv,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	if (isShellShim) {
		return spawn("cmd.exe", ["/c", binary, "app-server"], {
			env: childEnv,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	return spawn(binary, ["app-server"], {
		env: childEnv,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function emit(event) {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

/*
 * Stdout/stderr pipes are async in Node: a write queued right before
 * process.exit() can be dropped. Every diagnostic below rides on stderr
 * (agent-wrapper.sh merges it into stdout), so failing paths flush it before
 * exiting or the real error never reaches the runner's error detail.
 */
function writeFlushed(stream, text) {
	return new Promise((resolve) => {
		if (stream.write(text, () => resolve())) {
			resolve();
		}
	});
}

function emitNote(message) {
	process.stderr.write(`zcode-wrapper: ${message}\n`);
}

const args = parseArgs(process.argv.slice(2));
const binary = resolveBinary();
if (binary === undefined) {
	void writeFlushed(
		process.stderr,
		"zcode-wrapper: zcode binary not found. Set ZCODE_SANDCASTLE_BIN to the CLI entry " +
			"(e.g. the desktop bundle zcode.cjs), install zcode on PATH, or install the ZCode desktop app.\n",
	).then(() => process.exit(1));
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
		finished = true;
		void (async () => {
			await writeFlushed(
				process.stderr,
				`zcode-wrapper: zcode app-server exited early (code=${code ?? "null"} signal=${signal ?? "null"})\n`,
			);
			await dumpStderrTail();
			process.exit(1);
		})();
	}
});

/** Dump the buffered app-server stderr to the wrapper's stderr, flushed. */
async function dumpStderrTail() {
	const tail = stderrTail.join("").trim();
	if (tail !== "") {
		await writeFlushed(
			process.stderr,
			`zcode-wrapper: --- zcode stderr (last ${stderrTail.length} chunks) ---\n${tail.slice(-8_000)}\n`,
		);
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
		const note =
			`auto-answered permission for ${params?.toolName ?? "unknown tool"} ` +
			`(risk ${params?.riskLevel ?? "?"})`;
		emitNote(note);
		emit({ type: "note", text: note });
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
		const note = "auto-cancelled user input request (headless run)";
		emitNote(note);
		emit({ type: "note", text: note });
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

const TOOL_DETAIL_LIMIT = 400;

/** Trims a value into a bounded single string; non-strings fall back to JSON. */
function excerptValue(value) {
	if (typeof value === "string") {
		return value.trim().slice(0, TOOL_DETAIL_LIMIT);
	}

	if (typeof value === "object" && value !== null) {
		/*
		 * Inputs like {command: "..."} or {filePath: "..."} read better as the
		 * field value than as JSON; stringify only multi-field or non-string
		 * payloads.
		 */
		const entries = Object.entries(value).filter(
			([, fieldValue]) => typeof fieldValue === "string" && fieldValue.trim() !== "",
		);
		if (entries.length === 1) {
			return entries[0][1].trim().slice(0, TOOL_DETAIL_LIMIT);
		}

		if (entries.length > 1) {
			return entries
				.map(
					([key, fieldValue]) =>
						`${key}=${fieldValue.trim().slice(0, TOOL_DETAIL_LIMIT)}`,
				)
				.join(" ")
				.slice(0, TOOL_DETAIL_LIMIT);
		}
	}

	if (value === undefined || value === null) {
		return "";
	}

	try {
		return JSON.stringify(value).slice(0, TOOL_DETAIL_LIMIT);
	} catch {
		return "";
	}
}

/*
 * Extracts the readable slice of a tool.updated result payload — what ran and
 * what came back, mirroring what dirac's card bodies put in the digest.
 */
function toolResultDetail(result) {
	if (result === null || typeof result !== "object") {
		return excerptValue(result);
	}

	const pieces = [];
	const content = result.content ?? result.output ?? result.text;
	if (content !== null && typeof content === "object") {
		const output = excerptValue(content.content ?? content.text);
		if (output !== "") {
			pieces.push(`→ ${output}`);
		}
	} else {
		const output = excerptValue(content);
		if (output !== "") {
			pieces.push(`→ ${output}`);
		}
	}

	const perf = result.perf?.detail;
	if (perf?.command?.exitCode !== undefined) {
		pieces.push(`exit ${perf.command.exitCode}`);
	}

	if (result.success === false) {
		pieces.push("! failed");
	}

	return pieces.join("\n");
}

/*
 * Streaming progress detail while a tool runs: the running command (from
 * tool_input deltas) plus any output preview.
 */
function toolProgressDetail(progress, toolInputs) {
	const pieces = [];
	const input = excerptValue(toolInputs.get(progress.toolCallId));
	if (input !== "") {
		pieces.push(input);
	}

	const output = excerptValue(progress.outputPreview?.text ?? progress.stdoutTail);
	if (output !== "") {
		pieces.push(`→ ${output}`);
	}

	return pieces.join("\n");
}

/*
 * Readable detail for a legacy part.* tool event that reached a terminal
 * state: the part's own output/result/error slice.
 */
function toolDetail(part) {
	const state = part?.state ?? {};
	return excerptValue(state.output ?? state.result ?? state.error ?? state.text);
}

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

/** ToolCallId → accumulated tool_input text for progress detail. */
const toolInputs = new Map();
/** ToolCallId → last known tool name (result payloads omit toolName). */
const toolNames = new Map();
/** Signature of the last emitted tool event, for consecutive-duplicate suppression. */
let lastToolEmitKey = "";

function emitToolEvent(name, state, detail) {
	const key = `${name}:${state}:${detail}`;
	if (key === lastToolEmitKey) {
		return; // Real streams repeat started/running snapshots; keep the digest clean.
	}

	lastToolEmitKey = key;
	emit({ type: "tool", name, state, ...(detail !== "" ? { detail } : {}) });
}

function handleModelStreaming(payload) {
	markActivity();
	const kind = String(payload?.kind ?? "");
	if (kind === "text_delta") {
		const delta = String(payload?.delta ?? "");
		if (delta !== "") {
			emit({ type: "text", text: delta });
		}
		return;
	}

	if (kind === "tool_input_start" || kind === "tool_input_delta") {
		toolInputs.set(
			payload?.toolCallId,
			(toolInputs.get(payload?.toolCallId) ?? "") +
				String(payload?.delta ?? payload?.input ?? ""),
		);
		if (typeof payload?.toolName === "string" && payload.toolName !== "") {
			toolNames.set(payload?.toolCallId, payload.toolName);
		}
		return;
	}

	if (kind === "tool_call") {
		if (typeof payload?.toolName === "string" && payload.toolName !== "") {
			toolNames.set(payload?.toolCallId, payload.toolName);
		}
		emitToolEvent(
			String(payload?.toolName ?? toolNames.get(payload?.toolCallId) ?? "unknown"),
			"started",
			"",
		);
	}
	// reasoning_delta / tool_input_end carry nothing readable.
}

function handleToolUpdated(payload) {
	markActivity();
	const kind = String(payload?.kind ?? "");
	const toolCallId = payload?.toolCallId;
	if (typeof payload?.toolName === "string" && payload.toolName !== "") {
		toolNames.set(toolCallId, payload.toolName);
	}
	const name = String(payload?.toolName ?? toolNames.get(toolCallId) ?? "unknown");

	if (kind === "scheduled") {
		// Input may be omitted here; details come with tool_call + progress.
		return;
	}

	if (kind === "started") {
		emitToolEvent(name, "started", "");
		return;
	}

	if (kind === "progress") {
		emitToolEvent(name, "running", toolProgressDetail(payload, toolInputs));
		return;
	}

	if (kind === "result") {
		emitToolEvent(
			name,
			"completed",
			[excerptValue(toolInputs.get(toolCallId)), toolResultDetail(payload?.result)]
				.filter((piece) => piece !== "")
				.join("\n"),
		);
		return;
	}

	if (kind === "batch") {
		// Summary counts add nothing the per-tool events above missed.
	}
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

	if (type === "model.streaming") {
		handleModelStreaming(payload);
		return;
	}

	if (type === "tool.updated") {
		handleToolUpdated(payload);
		return;
	}

	if (type === "session.titleUpdated") {
		const title = String(payload?.title ?? "");
		if (title !== "") {
			emit({ type: "note", text: `session title: ${title.slice(0, TOOL_DETAIL_LIMIT)}` });
		}
		return;
	}

	if (type === "part.started" || type === "part.upserted") {
		const part = payload?.part;
		if (part?.type === "text") {
			emitTextSlice(String(part.partId), String(part.text ?? ""));
			return;
		}

		if (part?.type === "tool") {
			const state = String(part.state?.status ?? "unknown");
			const key = `${part.tool}:${state}`;
			if (key !== lastToolEventKey) {
				lastToolEventKey = key;
				markActivity();
				emit({
					type: "tool",
					name: String(part.tool),
					state,
					...(key.includes("completed") || key.includes("failed") || key.includes("error")
						? { detail: toolDetail(part) }
						: {}),
				});
			}
		}

		// reasoning parts are dropped (matches the dirac provider's isReasoning filter)
		return;
	}

	// part.delta, streamRecovery.updated, session.updated and unknown types
	// carry nothing readable.
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

async function fail(message) {
	await writeFlushed(process.stderr, `zcode-wrapper: ${message}\n`);
	const tail = stderrTail.join("").trim();
	if (tail !== "") {
		await writeFlushed(
			process.stderr,
			`zcode-wrapper: --- zcode stderr (last ${stderrTail.length} chunks) ---\n${tail.slice(-8_000)}\n`,
		);
	}

	finished = true;
	child.kill();
	process.exit(1);
}

child.on("error", (error) => {
	void fail(`failed to spawn zcode (${binary}): ${error.message}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		finished = true;
		void writeFlushed(
			process.stderr,
			`zcode-wrapper: received ${signal}; aborting session\n`,
		).then(() => process.exit(130));
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

/*
 * Resume the persisted session when asked (the app-server's session/resume
 * keeps the conversation history), otherwise create a fresh one. The resume
 * schema is stricter than create's: a root `model` key is rejected with
 * "Unrecognized key: model" (verified against the desktop app-server), so
 * resume keeps the session's existing model and forwards only the thought
 * level.
 */
let created;
try {
	if (args.resumeSession !== "") {
		created = await request(
			"session/resume",
			{
				sessionId: args.resumeSession,
				workspace: { workspaceKey: cwd, workspacePath: cwd },
				...(args.effort !== "" ? { thoughtLevel: args.effort } : {}),
			},
			120_000,
		);
	} else {
		created = await request(
			"session/create",
			{
				mode: args.mode,
				/*
				 * "immediate" persists the session into zcode's shared store at
				 * create time, so the run is visible in the desktop app under this
				 * workspace even if it dies before its first turn completes
				 * ("deferred" only persists after a completed turn).
				 */
				persistence: "immediate",
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
	}
} catch (err) {
	await fail(
		`${args.resumeSession !== "" ? "session/resume" : "session/create"} failed: ${err.message}`,
	);
}

const sessionId = created?.session?.sessionId;
if (sessionId === undefined || sessionId === "") {
	await fail(
		`${
			args.resumeSession !== "" ? "session/resume" : "session/create"
		} returned no sessionId: ${JSON.stringify(created)?.slice(0, 400)}`,
	);
}

emit({ type: "session_id", sessionId });

try {
	await request("session/subscribe", { deliveryKind: DELIVERY_KIND, sessionId }, 15_000);
} catch (err) {
	await fail(`session/subscribe failed: ${err.message}`);
}

markActivity();
try {
	await request("session/send", { content: prompt, sessionId }, 30_000);
} catch (err) {
	await shutdown(sessionId);
	await fail(`session/send failed: ${err.message}`);
}

await turnSettledPromise;
await shutdown(sessionId);

if (turnError !== undefined) {
	await fail(turnError.message);
}

process.exit(0);

/*
 * Stub zcode app-server for wrapper tests.
 *
 * Speaks the subset of the ZCode Protocol the sandcastle wrapper uses: the
 * runtime-preferences client-bound request, session/create, session/subscribe,
 * session/send, session/close, and session/event streaming. Mirrors the shape
 * of paseo's zcode-provider stub.
 */

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

let nextId = 0;
const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const reply = (id, result) => write({ id, result });
function emit(type, payload, sessionId) {
	return write({
		method: "session/event",
		params: { type, payload, seq: 0, sessionId, turnId: "turn-1" },
	});
}

const seen = [];
const mode = process.env.STUB_MODE ?? "yolo";
const failTurn = process.env.STUB_FAIL_TURN === "1";
const requestPermission = process.env.STUB_REQUEST_PERMISSION === "1";

// Snapshot the spawn env early: tests assert on the wrapper's env injection.
if (process.env.STUB_ENV_FILE !== undefined && process.env.STUB_ENV_FILE !== "") {
	writeFileSync(
		process.env.STUB_ENV_FILE,
		JSON.stringify({
			builtin: process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ?? null,
			personal: process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE ?? null,
			retryMaxRetries: process.env.ZCODE_MODEL_RETRY_MAX_RETRIES ?? null,
		}),
	);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
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

	if (frame.method === undefined) {
		return; // responses to our client-bound requests
	}

	recordFrame(frame);
	const { id, method, params } = frame;

	if (method === "session/create") {
		reply(id, {
			session: {
				mode,
				model: params?.model ?? { modelId: "default-model", providerId: "stub" },
				sessionId: "stub-session-1",
				status: "idle",
				title: "",
				workspace: params?.workspace ?? { workspaceKey: "", workspacePath: "" },
			},
		});
		return;
	}

	if (method === "session/subscribe") {
		reply(id, { events: [], eventSeq: 0, sessionId: params?.sessionId });
		return;
	}

	if (method === "session/send") {
		reply(id, {});
		const sessionId = params?.sessionId;
		if (requestPermission) {
			// Client-bound permission request answered by the wrapper.
			nextId += 1;
			write({
				id: nextId,
				method: "interaction/requestPermission",
				params: {
					input: { command: "ls" },
					options: [
						{
							kind: "allow",
							name: "Allow",
							optionId: "allow-once",
							response: { decision: "allow" },
						},
					],
					riskLevel: "medium",
					toolCallId: "tc-1",
					toolName: "bash",
				},
			});
		}

		emit("message.upserted", { content: "working", messageId: "msg-1" }, sessionId);

		/*
		 * Desktop-continuous delivery: the shapes a real app-server streams
		 * (model.streaming deltas + tool.updated lifecycle). The part.* shapes
		 * below cover the legacy contract.
		 */
		emit(
			"model.streaming",
			{ kind: "text_delta", delta: "working ", assistantMessageId: "msg-1" },
			sessionId,
		);
		emit(
			"model.streaming",
			{ kind: "tool_input_start", toolCallId: "tc-1", delta: "echo stub-run" },
			sessionId,
		);
		emit(
			"model.streaming",
			{ kind: "tool_call", toolCallId: "tc-1", toolName: "Bash" },
			sessionId,
		);
		emit(
			"tool.updated",
			{
				toolCallId: "tc-1",
				toolName: "Bash",
				kind: "progress",
				outputPreview: { text: "" },
			},
			sessionId,
		);
		emit(
			"tool.updated",
			{
				toolCallId: "tc-1",
				toolName: "Bash",
				kind: "result",
				success: true,
				result: {
					success: true,
					content: "stub-run",
					perf: { detail: { kind: "command", command: { exitCode: 0 } } },
				},
			},
			sessionId,
		);
		emit(
			"model.streaming",
			{ kind: "text_delta", delta: "hard", assistantMessageId: "msg-1" },
			sessionId,
		);
		emit(
			"session.titleUpdated",
			{ previousTitle: "", source: "first_input", title: "stub title" },
			sessionId,
		);

		if (failTurn) {
			emit("turn.failed", { error: { type: "stub", message: "stub explosion" } }, sessionId);
			return;
		}

		emit(
			"turn.completed",
			{
				response: "stub-pong",
				tokenCount: 10,
				toolCallCount: 1,
				usage: {
					cacheReadTokens: 5,
					cacheWriteTokens: 2,
					inputTokens: 10,
					outputTokens: 4,
				},
			},
			sessionId,
		);
		return;
	}

	// session/close and anything else
	reply(id, {});
});

/*
 * Record frames as they arrive: the wrapper terminates the stub abruptly on
 * shutdown, so a process-"exit" write would never run.
 */
function recordFrame(frame) {
	seen.push(frame);
	if (process.env.STUB_SEEN_FILE !== undefined) {
		writeFileSync(process.env.STUB_SEEN_FILE, JSON.stringify(seen));
	}
}

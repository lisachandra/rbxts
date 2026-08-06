/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import type { AgentProvider } from "@ai-hero/sandcastle";

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
	createAgent,
	diracAgent,
	fetchIssueLabels,
	skillsForPrompt,
	uniqueSkills,
	withMarkerCompletion,
} from "./agent.js";
import { io, packageRoot } from "./runtime.js";
import { registerTestHooks, stubExecSync } from "./test-helpers.js";
import type { AgentBackend } from "./types.js";

registerTestHooks();

const MARKER = "C:/sandcastle/markers/1.design.completed";
const SOME_TOKEN = "completion-token";
const PROTOCOL = '{"sandcastleMarker":"completed"}';

describe("skills and issue metadata", () => {
	test("skillsForPrompt includes label-specific skills and uniqueSkills dedupes", () => {
		assert.deepEqual(uniqueSkills(["a", "b", "a"]), ["a", "b"]);
		const design = skillsForPrompt("design", ["ecs", "security", "ui"]);
		assert.match(design, /domain-modeling/);
		assert.match(design, /threat-model/);
		assert.match(design, /react-roblox-ui/);
		assert.equal(design.split("\n").length, new Set(design.split("\n")).size);
	});

	test("fetchIssueLabels returns [] on failure and parses labels", () => {
		io.execSync = () => {
			throw new Error("gh down");
		};

		assert.deepEqual(fetchIssueLabels("1"), []);

		stubExecSync(JSON.stringify({ labels: [{ name: "ecs" }, { name: "" }, {}] }));
		assert.deepEqual(fetchIssueLabels("1"), ["ecs"]);
	});
});

describe("diracAgent", () => {
	test("buildPrintCommand and parseStreamLine", () => {
		const agent = diracAgent("gpt", {
			effort: "high",
			env: { OPENAI_API_KEY: "k" },
		});
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
		});
		assert.match(command.command, /dirac-wrapper\.sh/);
		assert.match(command.command, /-y/);
		assert.match(command.command, /--reasoning-effort high/);
		assert.equal(command.stdin, "hi");

		assert.deepEqual(agent.parseStreamLine("not-json"), []);
		assert.deepEqual(agent.parseStreamLine(JSON.stringify({ type: "task_started" })), []);

		const userEvents = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "markdown",
					content: `user prompt with ${SOME_TOKEN}`,
					isReasoning: false,
					role: "user",
				},
			}),
		);
		assert.deepEqual(userEvents, []);

		const assistantEvents = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "markdown",
					content: "partial",
					isReasoning: false,
					role: "assistant",
				},
			}),
		);
		assert.deepEqual(assistantEvents, [{ type: "text", text: "partial" }]);

		const card = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "card",
					card: { body: "plan body" },
				},
			}),
		);
		assert.deepEqual(card, [{ type: "result", result: "plan body" }]);

		const usage = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "api_status",
					status: {
						cacheReads: 1,
						cacheWrites: 2,
						tokensIn: 3,
						tokensOut: 4,
					},
				},
			}),
		);
		assert.deepEqual(usage, [
			{
				type: "usage",
				usage: {
					cacheCreationInputTokens: 2,
					cacheReadInputTokens: 1,
					inputTokens: 3,
					outputTokens: 4,
				},
			},
		]);
	});

	test("diracAgent maps max effort to the highest supported backend effort", () => {
		const agent = diracAgent("gpt", { effort: "max" });
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: false,
			prompt: "hi",
		});
		assert.match(command.command, /--reasoning-effort xhigh/);
		assert.doesNotMatch(command.command, /--reasoning-effort max/);
	});
});

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

describe("createAgent", () => {
	const backends: ReadonlyArray<AgentBackend> = [
		"claude-code",
		"codex",
		"copilot",
		"cursor",
		"dirac",
		"opencode",
		"pi",
	];

	test("returns a marker-wrapped provider for every backend", () => {
		const stubProvider = <T>(name: string) =>
			((model: string) => ({
				buildPrintCommand: () => ({ command: "stub", stdin: "prompt" }),
				captureSessions: false,
				env: {},
				name: `${name}:${model}`,
				parseStreamLine: () => [],
			})) as unknown as T;

		io.pi = stubProvider<typeof io.pi>("pi");
		io.codex = stubProvider<typeof io.codex>("codex");
		io.claudeCode = stubProvider<typeof io.claudeCode>("claude-code");
		io.cursor = stubProvider<typeof io.cursor>("cursor");
		io.opencode = stubProvider<typeof io.opencode>("opencode");
		io.copilot = stubProvider<typeof io.copilot>("copilot");

		for (const backend of backends) {
			const agent = createAgent(backend, "m", "low", MARKER);
			assert.equal(agent.name, backend === "dirac" ? "dirac" : `${backend}:m`);
			assert.equal(agent.env.SANDCASTLE_MARKER_COMPLETED, MARKER);
			assert.match(
				agent.buildPrintCommand({ dangerouslySkipPermissions: false, prompt: "p" }).command,
				/agent-wrapper\.sh/,
			);
		}
	});

	test("maps copilot effort to its supported range", () => {
		let receivedEffort: string | undefined;
		io.copilot = ((_model: string, options?: { effort?: string }) => {
			receivedEffort = options?.effort;
			return {
				buildPrintCommand: () => ({ command: "stub", stdin: "prompt" }),
				captureSessions: false,
				env: {},
				name: "copilot",
				parseStreamLine: () => [],
			};
		}) as unknown as typeof io.copilot;

		createAgent("copilot", "m", "max", MARKER);
		assert.equal(receivedEffort, "high");
	});
});

describe("prompt files", () => {
	test("all prompts use marker paths and no completion signal", () => {
		const promptsDir = join(packageRoot, "prompts");
		const files = readdirSync(promptsDir).filter((file) => file.endsWith(".md"));
		assert.ok(files.length >= 6);
		for (const file of files) {
			const content = readFileSync(join(promptsDir, file), "utf-8");
			assert.match(content, /\{\{MARKER_PATH\}\}/, `${file} should reference MARKER_PATH`);
			assert.doesNotMatch(
				content,
				/\{\{COMPLETION_SIGNAL\}\}/,
				`${file} should not reference COMPLETION_SIGNAL`,
			);
		}
	});
});

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { createAgent, diracAgent, fetchIssueLabels, resolveBackendEffort } from "./agent.js";
import { io, packageRoot } from "./runtime.js";
import { registerTestHooks, stubExecSync } from "./test-helpers.js";
import type { AgentBackend } from "./types.js";

registerTestHooks();

const MARKER = "C:/sandcastle/markers/1.design.completed";
const SOME_TOKEN = "completion-token";

describe("skills and issue metadata", () => {
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
		assert.match(command.command, /--api-error-max-retries 0/);
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

	test("diracAgent forwards max effort untouched (natively supported)", () => {
		const agent = diracAgent("gpt", { effort: "max" });
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: false,
			prompt: "hi",
		});
		assert.match(command.command, /--reasoning-effort max/);
		assert.doesNotMatch(command.command, /--reasoning-effort xhigh/);
	});

	test("resolveBackendEffort keeps max for dirac/claude-code, maps to xhigh elsewhere", () => {
		assert.equal(resolveBackendEffort("max", "dirac"), "max");
		assert.equal(resolveBackendEffort("max", "claude-code"), "max");
		assert.equal(resolveBackendEffort("max", "pi"), "xhigh");
		assert.equal(resolveBackendEffort("max", "codex"), "xhigh");
		assert.equal(resolveBackendEffort("max"), "xhigh");
		assert.equal(resolveBackendEffort("high", "dirac"), "high");
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

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
	createAgent,
	diracAgent,
	fetchIssueLabels,
	skillsForPrompt,
	uniqueSkills,
} from "./agent.js";
import { io } from "./runtime.js";
import { registerTestHooks, stubExecSync } from "./test-helpers.js";

registerTestHooks();

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

describe("agents", () => {
	test("diracAgent buildPrintCommand and parseStreamLine", () => {
		const agent = diracAgent("gpt", {
			completionSignal: "<promise>DONE</promise>",
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
					content: "user prompt with <promise>DONE</promise>",
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

		const signalEvents = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "markdown",
					content: "done <promise>DONE</promise>",
					isReasoning: false,
					role: "assistant",
				},
			}),
		);
		assert.equal(
			signalEvents.some((event) => event.type === "result"),
			true,
		);

		const cardAfterSignal = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "card",
					card: { body: "card body" },
				},
			}),
		);
		assert.deepEqual(cardAfterSignal, []);

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

	test("diracAgent emits card results before completion signal", () => {
		const agent = diracAgent("gpt", { completionSignal: "SIG" });
		agent.parseStreamLine(JSON.stringify({ type: "task_started" }));
		const card = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "card",
					card: { body: "plan body" },
				},
			}),
		);
		assert.deepEqual(card, [{ type: "result", result: "plan body" }]);
	});

	test("diracAgent maps max effort to the highest supported backend effort", () => {
		const agent = diracAgent("gpt", { completionSignal: "SIG", effort: "max" });
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: false,
			prompt: "hi",
		});
		assert.match(command.command, /--reasoning-effort xhigh/);
		assert.doesNotMatch(command.command, /--reasoning-effort max/);
	});

	test("createAgent selects supported backends", () => {
		io.pi = ((model: string) => ({ name: `pi:${model}` })) as typeof io.pi;
		assert.equal((createAgent("pi", "m", "low") as { name: string }).name, "pi:m");
		assert.equal(createAgent("dirac", "m", "low", "SIG").name, "dirac");
	});
});

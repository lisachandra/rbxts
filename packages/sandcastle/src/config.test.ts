/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { loadConfig } from "./config.js";
import { registerTestHooks, tmpRoot } from "./test-helpers.js";

registerTestHooks();

describe("config loading", () => {
	test("loadConfig uses defaults when no config file exists", () => {
		const dir = join(tmpRoot, "config-defaults");
		mkdirSync(dir, { recursive: true });
		const config = loadConfig(dir);
		assert.equal(config.dir, ".sandcastle");
		assert.equal(config.baseBranch, "main");
		assert.equal(config.effort, "xhigh");
		assert.equal(config.agents.default, "dirac");
		assert.deepEqual(config.agents.models, {});
		assert.deepEqual(config.agents.enabled, [
			"claude-code",
			"codex",
			"copilot",
			"cursor",
			"dirac",
			"opencode",
			"pi",
		]);
		assert.equal(config.prompts.plan.endsWith("plan-prompt.md"), true);
	});

	test("loadConfig merges repo config over defaults", () => {
		const dir = join(tmpRoot, "config-override");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			[
				"const config = {",
				'	effort: "max",',
				'	agents: { default: "codex", models: { "claude-code": "model-c", codex: "model-d", dirac: "model-a", pi: "model-b" } },',
				"};",
				"export default config;",
			].join("\n"),
			"utf-8",
		);
		const config = loadConfig(dir);
		assert.equal(config.effort, "max");
		assert.equal(config.agents.default, "codex");
		assert.equal(config.agents.models["claude-code"], "model-c");
		assert.equal(config.agents.models.codex, "model-d");
		assert.equal(config.agents.models.dirac, "model-a");
		assert.equal(config.agents.models.pi, "model-b");
		assert.equal(config.baseBranch, "main");
	});
});

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
		assert.deepEqual(config.agents.steps, {});
		assert.deepEqual(config.agents.enabled, [
			"claude-code",
			"codex",
			"copilot",
			"cursor",
			"dirac",
			"opencode",
			"pi",
			"zcode",
		]);
		assert.equal(config.prompts.plan.endsWith("plan-prompt.md"), true);
		assert.equal(config.integration.mergeSubject, "chore(integration): integrate {source}");
		assert.equal(config.integration.verifyHooks, false);
		assert.equal(config.skills.defaults.review.includes("sandcastle"), true);
		/*
		 * Unset, not defaulted: each command resolves its own default (agent runs log, standalone
		 * `sandcastle setup` inherits), so a repository without a preference must stay undefined.
		 */
		assert.equal(config.setupOutput, undefined);
	});

	test("loadConfig merges repo config over defaults", () => {
		const dir = join(tmpRoot, "config-override");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			[
				"const config = {",
				'	effort: "max",',
				'	agents: { default: "codex", models: { "claude-code": "model-c", codex: "model-d", dirac: "model-a", pi: "model-b" }, steps: { design: { model: "design-m", effort: "low" }, implement: { backend: "codex" } } },',
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
		assert.deepEqual(config.agents.steps.design, { effort: "low", model: "design-m" });
		assert.deepEqual(config.agents.steps.implement, { backend: "codex" });
		assert.equal(config.baseBranch, "main");
	});

	test("loadConfig keeps an explicit setupOutput", () => {
		const dir = join(tmpRoot, "config-setup-output");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			[
				"const config = {",
				'	setupOutput: "inherited",',
				"};",
				"export default config;",
			].join("
"),
			"utf-8",
		);

		assert.throws(() => loadConfig(dir), /setupOutput|inherit/);
	});

	test("loadConfig accepts setupOutput inherit and log", () => {
		for (const mode of ["inherit", "log"] as const) {
			const dir = join(tmpRoot, `config-setup-output-${mode}`);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "sandcastle.config.ts"),
				[
					"const config = {",
					`	setupOutput: ${JSON.stringify(mode)},`,
					"};",
					"export default config;",
				].join("
"),
				"utf-8",
			);

			assert.equal(loadConfig(dir).setupOutput, mode);
		}
	});
});

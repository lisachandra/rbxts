import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

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
		// A rewind warns by default; `queue.strictChain` is the opt-in abort.
		assert.equal(config.queue.strictChain, false);
		/*
		 * Unset, not defaulted: each command resolves its own default (agent runs log, standalone
		 * `sandcastle setup` inherits), so a repository without a preference must stay undefined.
		 */
		assert.equal(config.setupOutput, undefined);
		// No catalog means the repository never opted into lanes; dispatch stays single-model.
		assert.deepEqual(config.agents.catalog, []);
		assert.equal(config.queue.parallel, 1);
		// `auto` takes the cross-machine lease when `origin` allows it and degrades to local locks.
		assert.equal(config.queue.lease, "auto");
	});

	/** Writes a config file into its own directory and loads it. */
	function loadFrom(name: string, source: ReadonlyArray<string>): ReturnType<typeof loadConfig> {
		const dir = join(tmpRoot, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "sandcastle.config.ts"), source.join("\n"), "utf-8");
		return loadConfig(dir);
	}

	test("loadConfig accepts an agents.catalog with per-step overrides", () => {
		const config = loadFrom(`${"config-catalog"}-valid`, [
			"const config = {",
			"	agents: {",
			"		catalog: [",
			'			{ name: "flash", backend: "zcode", model: "flash-m", effort: "high" },',
			'			{ name: "deep", backend: "dirac", model: "deep-m", steps: { review: { effort: "low" } } },',
			"		],",
			"	},",
			"	queue: { parallel: 3 },",
			"};",
			"export default config;",
		]);

		assert.deepEqual(
			config.agents.catalog.map((profile) => profile.name),
			["flash", "deep"],
		);
		assert.equal(config.agents.catalog[1]?.steps?.review?.effort, "low");
		assert.equal(config.queue.parallel, 3);
	});

	test("loadConfig rejects a duplicate catalog profile name", () => {
		assert.throws(
			() =>
				loadFrom("config-catalog-duplicate", [
					"const config = {",
					"	agents: {",
					"		catalog: [",
					'			{ name: "flash", backend: "zcode", model: "a" },',
					'			{ name: "flash", backend: "pi", model: "b" },',
					"		],",
					"	},",
					"};",
					"export default config;",
				]),
			/repeats the profile name "flash"/u,
		);
	});

	test("loadConfig rejects a catalog profile whose backend is disabled", () => {
		assert.throws(
			() =>
				loadFrom("config-catalog-disabled", [
					"const config = {",
					"	agents: {",
					'		enabled: ["zcode"],',
					'		catalog: [{ name: "pi-lane", backend: "pi", model: "m" }],',
					"	},",
					"};",
					"export default config;",
				]),
			/profile "pi-lane" uses backend "pi", which agents\.enabled does not list/u,
		);
	});

	test("loadConfig rejects queue.parallel below one", () => {
		assert.throws(
			() =>
				loadFrom("config-parallel-zero", [
					"const config = { queue: { parallel: 0 } };",
					"export default config;",
				]),
			/parallel/u,
		);
	});

	test("loadConfig accepts each queue.lease mode and rejects an unknown one", () => {
		for (const mode of ["auto", "off", "strict"] as const) {
			const config = loadFrom(`config-lease-${mode}`, [
				`const config = { queue: { lease: "${mode}" } };`,
				"export default config;",
			]);
			assert.equal(config.queue.lease, mode);
		}

		assert.throws(
			() =>
				loadFrom("config-lease-bogus", [
					'const config = { queue: { lease: "sometimes" } };',
					"export default config;",
				]),
			/lease/u,
		);
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
				"	queue: { strictChain: true },",
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
		assert.equal(config.queue.strictChain, true);
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
			].join("\n"),
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
				].join("\n"),
				"utf-8",
			);

			assert.equal(loadConfig(dir).setupOutput, mode);
		}
	});
});

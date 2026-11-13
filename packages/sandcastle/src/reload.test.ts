/*
 * Live configuration reload: the precedence rule, the diff, and the engine's state machine.
 *
 * The engine is pointed at a throwaway directory rather than this checkout, so a test writes the
 * config file it is asserting on and never the repository's own.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

import { loadConfig } from "./config.js";
import {
	ConfigReloader,
	ConfigReloadError,
	describeStepChange,
	diffSteps,
	effectiveSteps,
	launchSelection,
	logReloadOutcome,
	reloadCheckMs,
	resolveReloadCheckMs,
	sameStep,
	watchStep,
} from "./reload.js";
import { registerTestHooks, tmpRoot, withEnv } from "./test-helpers.js";

registerTestHooks();

/** Writes a config file into its own directory and returns the directory. */
function configDir(name: string, source: ReadonlyArray<string>): string {
	const dir = join(tmpRoot, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "sandcastle.config.ts"), source.join("\n"), "utf-8");
	return dir;
}

/**
 * A config whose workflow seam is one model and whose review step names another.
 *
 * Both are needed to observe the per-step rule: an edit to the workflow default must not move a
 * step that names its own model.
 */
const baseConfig = [
	"export default {",
	'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "base-model" } },',
	'	baseBranch: "main",',
	"};",
];

describe("effective step resolution", () => {
	test("a profile replaces the workflow default for every step it does not override", () => {
		const dir = configDir("reload-profile", [
			"export default {",
			'	agents: { default: "dirac", enabled: ["dirac", "zcode"],',
			'		catalog: [{ name: "flash", backend: "zcode", model: "flash-model", effort: "low" }],',
			'		models: { dirac: "dirac-model" } },',
			"};",
		]);

		const steps = effectiveSteps(
			loadConfig(dir),
			launchSelection({
				agentBackend: "dirac",
				effort: "xhigh",
				model: "",
				queueProfile: "flash",
				steps: {},
			}),
		);
		assert.equal(steps.design.agentBackend, "zcode");
		assert.equal(steps.design.model, "flash-model");
		assert.equal(steps.design.effort, "low");
		assert.equal(steps.implement.model, "flash-model");
	});

	test("a CLI step flag wins over both the config and the profile", () => {
		const dir = configDir("reload-cli-wins", [
			"export default {",
			'	agents: { default: "dirac", enabled: ["dirac", "zcode"],',
			'		catalog: [{ name: "flash", backend: "zcode", model: "flash-model" }],',
			'		models: { dirac: "dirac-model" } },',
			"};",
		]);

		const steps = effectiveSteps(
			loadConfig(dir),
			launchSelection({
				agentBackend: "dirac",
				effort: "xhigh",
				model: "",
				queueProfile: "flash",
				steps: { design: { model: "pinned-design" } },
			}),
		);
		assert.equal(steps.design.model, "pinned-design");
		assert.equal(steps.implement.model, "flash-model");
	});

	test("sameStep and diffSteps compare the whole selection, and describe names the winner", () => {
		const step = { agentBackend: "zcode" as const, effort: "high" as const, model: "a" };
		assert.equal(sameStep(step, { ...step }), true);
		assert.equal(sameStep(step, { ...step, effort: "low" }), false);
		assert.equal(sameStep(step, { ...step, model: "b" }), false);
		assert.equal(sameStep(step, { ...step, agentBackend: "dirac" }), false);

		const map = (model: string): Record<string, typeof step> =>
			Object.fromEntries(
				["design", "implement", "review", "planner", "resolve", "integrationReview"].map(
					(name) => [name, { ...step, model }],
				),
			);
		const changes = diffSteps(
			map("a") as never,
			{ ...map("b"), review: { ...step, model: "a" } } as never,
		);
		assert.deepEqual(
			changes.map((change) => change.step),
			["design", "implement", "planner", "resolve", "integrationReview"],
		);
		assert.equal(
			describeStepChange({ after: { ...step, model: "b" }, before: step, step: "design" }),
			"design zcode/a → zcode/b",
		);
	});
});

describe("config reload engine", () => {
	test("an untouched file reports unchanged without re-resolving", () => {
		const dir = configDir("reload-untouched", baseConfig);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);
		assert.equal(reloader.check().kind, "unchanged");
		assert.equal(reloader.step("implement").model, "base-model");
	});

	test("a changed workflow model moves every step that inherited it", () => {
		const dir = configDir("reload-model", [
			"export default {",
			'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "one" } },',
			"};",
		]);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			'export default { agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "two" } } };',
			"utf-8",
		);

		const outcome = reloader.check();
		assert.equal(outcome.kind, "applied");
		assert.ok(outcome.kind === "applied");
		assert.equal(outcome.changes.length, 6);
		assert.equal(reloader.step("implement").model, "two");
	});

	test("a step the edit did not touch keeps the operator's flag", () => {
		/*
		 * The rule the whole feature rests on. `--implement-model` was the operator's last word, and an
		 * edit to `review` in the config file is not a reason to discard it — but the edit to `review`
		 * itself must still land, or the config editor would be silently ineffective.
		 */
		const dir = configDir("reload-keeps-flag", [
			"export default {",
			'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "one" },',
			'		steps: { review: { model: "review-one" } } },',
			"};",
		]);
		const reloader = new ConfigReloader(
			launchSelection({
				agentBackend: "zcode",
				effort: "xhigh",
				model: "",
				steps: { implement: { model: "pinned" } },
			}),
			loadConfig(dir),
			dir,
		);
		assert.equal(reloader.step("implement").model, "pinned");

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			[
				"export default {",
				'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "one" },',
				'		steps: { review: { model: "review-two" } } },',
				"};",
			].join("\n"),
			"utf-8",
		);

		const outcome = reloader.check();
		assert.ok(outcome.kind === "applied", JSON.stringify(outcome));
		assert.deepEqual(
			outcome.changes.map((change) => change.step),
			["review"],
		);
		assert.equal(reloader.step("review").model, "review-two");
		assert.equal(reloader.step("implement").model, "pinned", "the flag must survive");
	});

	test("a step whose config value changed takes the new value even over a flag", () => {
		/*
		 * "Changed wins" per step. Otherwise a repository-wide model rename would leave the phase the
		 * operator was actually watching — the one they happened to pin — running the old model.
		 */
		const dir = configDir("reload-changed-wins", [
			"export default {",
			'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "one" } },',
			"};",
		]);
		const reloader = new ConfigReloader(
			launchSelection({
				agentBackend: "zcode",
				effort: "xhigh",
				model: "",
				steps: { implement: { model: "pinned" } },
			}),
			loadConfig(dir),
			dir,
		);

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			'export default { agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "two" } } };',
			"utf-8",
		);

		const outcome = reloader.check();
		assert.ok(outcome.kind === "applied", JSON.stringify(outcome));
		assert.equal(reloader.step("implement").model, "two");
	});

	test("a catalog edit applies by profile name", () => {
		const dir = configDir("reload-catalog", [
			"export default {",
			'	agents: { default: "zcode", enabled: ["zcode"],',
			'		catalog: [{ name: "flash", backend: "zcode", model: "flash-one" }] },',
			"};",
		]);
		const reloader = new ConfigReloader(
			launchSelection({
				agentBackend: "zcode",
				effort: "xhigh",
				model: "",
				queueProfile: "flash",
				steps: {},
			}),
			loadConfig(dir),
			dir,
		);
		assert.equal(reloader.step("design").model, "flash-one");

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			[
				"export default {",
				'	agents: { default: "zcode", enabled: ["zcode"],',
				'		catalog: [{ name: "flash", backend: "zcode", model: "flash-two" }] },',
				"};",
			].join("\n"),
			"utf-8",
		);

		assert.equal(reloader.check().kind, "applied");
		assert.equal(reloader.step("design").model, "flash-two");
	});

	test("a config that does not parse keeps the running selection and reports once", () => {
		const dir = configDir("reload-invalid", baseConfig);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);

		writeFileSync(join(dir, "sandcastle.config.ts"), "export default { nope", "utf-8");
		const first = reloader.check();
		assert.equal(first.kind, "invalid");
		assert.ok(first.kind === "invalid" && first.error !== "");
		assert.equal(reloader.step("implement").model, "base-model");

		/* The same broken file: reported as an empty-string repeat, which the logger suppresses. */
		const repeat = reloader.check();
		assert.ok(repeat.kind === "invalid" && repeat.error === "");

		/* Fixed in place: the next check picks it up, because the applied mtime was never recorded. */
		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			'export default { agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "fixed" } } };',
			"utf-8",
		);
		assert.equal(reloader.check().kind, "applied");
		assert.equal(reloader.step("implement").model, "fixed");
	});

	test("a backend change is refused with restart-required rather than adopted", () => {
		const dir = configDir("reload-backend", baseConfig);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			'export default { agents: { default: "zcode", enabled: ["zcode", "dirac"], steps: { review: { backend: "dirac" } } } };',
			"utf-8",
		);

		const outcome = reloader.check();
		assert.ok(outcome.kind === "refused", JSON.stringify(outcome));
		assert.equal(outcome.refusal.requiresRestart, true);
		assert.match(outcome.refusal.reason, /review backend changed/u);
		assert.equal(reloader.step("review").agentBackend, "zcode");
	});

	test("a state-directory change is refused", () => {
		const dir = configDir("reload-dir", baseConfig);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			'export default { dir: ".elsewhere" };',
			"utf-8",
		);

		const outcome = reloader.check();
		assert.ok(outcome.kind === "refused", JSON.stringify(outcome));
		assert.match(outcome.refusal.reason, /state directory changed/u);
	});

	test("a non-agent edit is reported but changes no step", () => {
		const dir = configDir("reload-non-agent", baseConfig);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			[
				"export default {",
				'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "base-model" } },',
				'	baseBranch: "main",',
				'	setupCommands: ["pnpm install"],',
				"};",
			].join("\n"),
			"utf-8",
		);

		assert.equal(reloader.check().kind, "applied-non-agent");
		assert.equal(reloader.step("implement").model, "base-model");
	});

	test("deleting the config file reverts to the defaults", () => {
		const dir = configDir("reload-delete", [
			"export default {",
			'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "was-here" } },',
			"};",
		]);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);
		/* Settles the "no stamp yet" state, so the removal is what the next check sees. */
		reloader.check();
		assert.equal(reloader.step("implement").model, "was-here");

		rmSync(join(dir, "sandcastle.config.ts"), { force: true });
		reloader.check();
		/* No `agents.models` left, so the step resolves to the empty model; the launch had none. */
		assert.equal(reloader.step("implement").model, "");
	});
});

describe("reload reporting and watching", () => {
	test("watchStep aborts only for its own phase, and compares against its own start", () => {
		const dir = configDir("reload-watch", [
			"export default {",
			'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "one" } },',
			"};",
		]);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);
		const watchImplement = watchStep(reloader, "implement");

		/* Unchanged file: no abort. */
		assert.equal(watchImplement(), undefined);

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			[
				"export default {",
				'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "one" } },',
				'	baseBranch: "develop",',
				"};",
			].join("\n"),
			"utf-8",
		);
		/* A non-agent edit must not kill a half-finished turn. */
		assert.equal(watchImplement(), undefined);
	});

	test("a phase's watcher sees a change another watcher already applied", () => {
		/*
		 * Two `watchStep` closures can share one reloader — implement and review are sequential today,
		 * but the comparison is deliberately against each closure's own start value rather than the
		 * check's outcome, so neither can be blinded by the other's check.
		 */
		const dir = configDir("reload-two-watchers", [
			"export default {",
			'	agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "one" } },',
			"};",
		]);
		const reloader = new ConfigReloader(
			launchSelection({ agentBackend: "zcode", effort: "xhigh", model: "", steps: {} }),
			loadConfig(dir),
			dir,
		);
		const watchDesign = watchStep(reloader, "design");
		const watchReview = watchStep(reloader, "review");

		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			'export default { agents: { default: "zcode", enabled: ["zcode"], models: { zcode: "two" } } };',
			"utf-8",
		);

		const designDetail = watchDesign();
		assert.equal(typeof designDetail, "string");
		assert.match(String(designDetail), /design zcode\/one → zcode\/two/u);
		/* The second watcher observes its own move even though the check now says `unchanged`. */
		const reviewDetail = watchReview();
		assert.match(String(reviewDetail), /review zcode\/one → zcode\/two/u);
	});

	test("logReloadOutcome names each change and stays quiet when nothing happened", () => {
		const lines: Array<string> = [];
		const warns: Array<string> = [];
		const originalLog = console.log;
		const originalWarn = console.warn;
		console.log = (...args: Array<unknown>) => {
			lines.push(args.map(String).join(" "));
		};

		console.warn = (...args: Array<unknown>) => {
			warns.push(args.map(String).join(" "));
		};

		try {
			logReloadOutcome({ kind: "unchanged" });
			logReloadOutcome({ kind: "applied-non-agent" });
			logReloadOutcome({
				changes: [
					{
						after: { agentBackend: "zcode", effort: "high", model: "b" },
						before: { agentBackend: "zcode", effort: "high", model: "a" },
						step: "implement",
					},
				],
				kind: "applied",
			});
			logReloadOutcome({ error: "", kind: "invalid" });
			logReloadOutcome({ error: "boom", kind: "invalid" });
			logReloadOutcome({
				kind: "refused",
				refusal: { reason: "state directory changed", requiresRestart: true },
			});
		} finally {
			console.log = originalLog;
			console.warn = originalWarn;
		}

		assert.equal(
			lines.length,
			2,
			`expected only the two applied lines, got ${JSON.stringify(lines)}`,
		);
		assert.match(lines[1] ?? "", /implement zcode\/a → zcode\/b/u);
		assert.equal(warns.length, 2, "a repeated invalid config must not warn twice");
		assert.match(warns[0] ?? "", /did not load/u);
		assert.match(warns[1] ?? "", /Start a new run to apply it/u);
	});

	test("the poll interval is a constant a phase can rely on", () => {
		assert.equal(reloadCheckMs, 30_000);

		withEnv({ SANDCASTLE_RELOAD_CHECK_SECONDS: "2" }, () => {
			assert.equal(resolveReloadCheckMs(), 2_000);
		});
		withEnv({ SANDCASTLE_RELOAD_CHECK_SECONDS: "0" }, () => {
			assert.equal(resolveReloadCheckMs(), reloadCheckMs);
		});
		withEnv({ SANDCASTLE_RELOAD_CHECK_SECONDS: "soon" }, () => {
			assert.equal(
				resolveReloadCheckMs(),
				reloadCheckMs,
				"a bad value must not disable the check",
			);
		});
	});

	test("a reload abort carries its own error type", () => {
		const error = new ConfigReloadError("implement zcode/a → zcode/b");
		assert.equal(error instanceof Error, true);
		assert.equal(error.name, "ConfigReloadError");
		assert.match(error.message, /implement zcode\/a → zcode\/b/u);
	});

	test("the legacy env model is part of the config-only resolution", () => {
		/*
		 * `steps.ts` falls back to `DIRAC_SANDCASTLE_MODEL` when `agents.models` has no entry. The
		 * reloader must resolve the same value the CLI did, or it would report a change on its very
		 * first check and restart the phase for nothing.
		 */
		const dir = configDir("reload-legacy-env", [
			'export default { agents: { default: "dirac", enabled: ["dirac"] } };',
		]);

		withEnv({ DIRAC_SANDCASTLE_MODEL: "env-model" }, () => {
			const source = loadConfig(dir);
			const steps = effectiveSteps(
				source,
				launchSelection({
					agentBackend: "dirac",
					effort: "xhigh",
					model: "env-model",
					steps: {},
				}),
			);
			assert.equal(steps.implement.model, "env-model");
		});
	});
});

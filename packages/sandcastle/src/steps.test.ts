import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { phaseSteps, resolveAgentStep, resolveAgentSteps } from "./steps.js";

describe("per-step agent resolution", () => {
	test("workflow defaults fill every step", () => {
		const steps = resolveAgentSteps({ agentBackend: "dirac", effort: "xhigh", model: "m" }, {});
		for (const name of [
			"design",
			"implement",
			"review",
			"planner",
			"resolve",
			"integrationReview",
		] as const) {
			assert.deepEqual(steps[name], {
				agentBackend: "dirac",
				effort: "xhigh",
				model: "m",
			});
		}
	});

	test("CLI flag beats config beats workflow default", () => {
		const steps = resolveAgentSteps(
			{ agentBackend: "dirac", effort: "low", model: "workflow" },
			{},
			{ design: { effort: "medium", model: "config-model" } },
			{ design: { model: "cli-model" } },
		);
		assert.equal(steps.design.model, "cli-model");
		assert.equal(steps.design.effort, "medium");
		const configOnly = resolveAgentSteps(
			{ agentBackend: "dirac", effort: "low", model: "workflow" },
			{},
			{ implement: { model: "config-model" } },
			{},
		);
		assert.equal(configOnly.implement.model, "config-model");
		assert.equal(configOnly.implement.agentBackend, "dirac");
	});

	test("backend-switched step falls back to mapped model", () => {
		const steps = resolveAgentSteps(
			{ agentBackend: "dirac", effort: "low", model: "dirac-model" },
			{ codex: "codex-model" },
			{ review: { backend: "codex" } },
			{},
		);
		assert.equal(steps.review.agentBackend, "codex");
		assert.equal(steps.review.model, "codex-model");
		assert.equal(steps.design.model, "dirac-model");
	});

	test("resolveAgentStep trims models and phaseSteps narrows", () => {
		const single = resolveAgentStep(
			{ model: "  x  " },
			undefined,
			{ agentBackend: "dirac", effort: "low", model: "w" },
			{},
		);
		assert.equal(single.model, "x");
		const narrowed = phaseSteps(
			{ design: single },
			{ agentBackend: "dirac", effort: "low", model: "w" },
		);
		assert.equal(narrowed.design.model, "x");
		assert.equal(narrowed.implement.model, "w");
		assert.equal(narrowed.review.model, "w");
	});
});

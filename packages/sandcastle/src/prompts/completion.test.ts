/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { completionPromptArgs, completionRules } from "./completion.js";

describe("completion prompt block", () => {
	test("hands the agent the marker the runner waits for, in bash form", () => {
		const rules = completionRules("C:\\sandcastle\\markers\\7.review.completed");

		assert.match(
			rules,
			/mkdir -p "C:\/sandcastle\/markers" && touch "C:\/sandcastle\/markers\/7\.review\.completed"/u,
		);
	});

	test("lets a phase name the step the marker must follow", () => {
		const rules = completionRules("/tmp/planner.completed", {
			before: "the `<plan>` block is printed",
		});

		assert.match(rules, /once the `<plan>` block is printed/u);
	});

	test("defaults the marker to the end of the phase's required steps", () => {
		assert.match(
			completionRules("/tmp/m.completed"),
			/once every required step above is finished/u,
		);
	});

	test("leaves the phase's last actions in order", () => {
		const rules = completionRules("/tmp/m.completed");

		assert.match(rules, /as your final action/u);
		assert.match(rules, /already exited/u);
		assert.match(rules, /no completion token, no marker path/u);
	});

	test("bakes the marker path into the argument a prompt substitutes", () => {
		const args = completionPromptArgs("/tmp/m.completed", { before: "the plan is saved" });

		assert.match(args.COMPLETION, /touch "\/tmp\/m\.completed"/u);
		assert.doesNotMatch(args.COMPLETION, /\{\{/u);
	});
});

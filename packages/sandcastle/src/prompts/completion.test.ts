import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { completionPromptArgs, completionRules } from "./completion.js";

describe("completion prompt block", () => {
	/*
	 * The marker command has two host-dependent halves, and they are asserted apart. The `touch`
	 * target is only a backslash conversion, so a Windows-style input renders the same everywhere.
	 * The `mkdir` directory comes from the host's own `dirname`, so a Windows literal on a POSIX
	 * host yields `"."` — a property of the test host, not of the block, which is what made the
	 * original single assertion fail on the Linux CI leg.
	 */
	test("renders the marker path backslash-free for bash", () => {
		const rules = completionRules("C:\\sandcastle\\markers\\7.review.completed");
		const command = /^```\n(.+)\n```$/mu.exec(rules)?.[1] ?? "";

		assert.match(command, /touch "C:\/sandcastle\/markers\/7\.review\.completed"/u);
		assert.doesNotMatch(command, /\\/u, "a backslash in the command would escape in bash");
	});

	test("creates the marker's own directory before touching the file", () => {
		const rules = completionRules("/sandcastle/markers/7.review.completed");

		assert.match(
			rules,
			/mkdir -p "\/sandcastle\/markers" && touch "\/sandcastle\/markers\/7\.review\.completed"/u,
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

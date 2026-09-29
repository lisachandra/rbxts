/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { config } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";
import { queueRulesForPrompt } from "./queue.js";

registerTestHooks();

function withQueueEnabled(enabled: boolean, run: () => void): void {
	const queue = config.queue as { enabled: boolean };
	const previous = queue.enabled;
	queue.enabled = enabled;
	try {
		run();
	} finally {
		queue.enabled = previous;
	}
}

describe("queue prompt rules", () => {
	test("an enabled queue demands registration through the command group", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt();

			assert.match(rules, /sandcastle queue add/u);
			assert.match(rules, /sandcastle queue check/u);
			assert.match(rules, /queue\.commit/u);
			assert.doesNotMatch(rules, /queue\.enabled: false/u);
		});
	});

	test("a disabled queue tells the review to report follow-ups in the comment only", () => {
		withQueueEnabled(false, () => {
			const rules = queueRulesForPrompt();

			assert.match(rules, /queue\.enabled: false/u);
			assert.match(rules, /do not run `sandcastle queue`/u);
			assert.doesNotMatch(rules, /sandcastle queue add/u);
		});
	});

	test("names the running batch, so a follow-up continues it instead of parking behind a gate", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ batch: "audio-seam-work" });

			assert.match(rules, /still running/u);
			assert.match(rules, /queue add --issue <N> --sequence audio-seam-work/u);
			assert.match(rules, /re-fires the batch/u);
		});
	});

	test("says a follow-up cannot join a batch that is already composed", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ composed: true });

			assert.match(rules, /already composed/u);
			assert.match(rules, /a follow-up cannot join it/u);
		});
	});

	test("tells the review to fix what it can before filing a follow-up", () => {
		withQueueEnabled(true, () => {
			assert.match(queueRulesForPrompt(), /Fix it here when you can/u);
		});
	});

	test("the queue is enabled by default", () => {
		assert.equal(config.queue.enabled, true);
		assert.equal(config.queue.commit, false);
		assert.equal(config.queue.file, "sandcastle.queue.json");
	});
});

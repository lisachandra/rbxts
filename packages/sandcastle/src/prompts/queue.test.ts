import assert from "node:assert/strict";
import { describe, test } from "vitest";

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
			assert.match(rules, /there is no queue here to write to/u);
			assert.doesNotMatch(rules, /sandcastle queue add/u);
		});
	});

	test("names the running batch, so a follow-up continues it instead of parking behind a gate", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ batch: "audio-seam-work" });

			assert.match(rules, /still running/u);
			assert.match(rules, /queue add --issue <N> --sequence audio-seam-work/u);
			assert.match(rules, /re-fires the batch/u);
			assert.match(rules, /--after/);
		});
	});

	test("says a follow-up cannot join a batch that is already composed", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ composed: true });

			assert.match(rules, /already composed/u);
			assert.match(rules, /a follow-up cannot join it/u);
		});
	});

	test("keeps the fix-versus-file rule in the injected rules, not the prompt file", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ batch: "audio-seam-work" });

			assert.doesNotMatch(rules, /Fix a finding here when the correction is small/u);
			assert.match(rules, /joins that batch/u);
		});
	});

	test("tells the review to fix what it can before filing a follow-up", () => {
		withQueueEnabled(true, () => {
			assert.match(queueRulesForPrompt(), /Fix it here when you can/u);
		});
	});

	test("a deferred-by-design follow-up is APPROVED, and BLOCKED is reserved for do-not-chain", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt();

			assert.match(rules, /deferred-by-design follow-up is APPROVED/u);
			assert.match(rules, /Reserve BLOCKED for/u);
			assert.match(rules, /--after <this-issue>/u);
		});
	});

	test("searches for duplicates but keeps the follow-up in the running batch", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ batch: "audio-seam-work" });

			assert.match(rules, /That search is for duplicates, not placement/u);
			assert.match(rules, /reference that member instead/u);
			assert.match(rules, /almost never in another batch/u);
		});
	});

	test("a follow-up is a repair of this diff, not a new subsystem", () => {
		withQueueEnabled(true, () => {
			assert.match(
				queueRulesForPrompt(),
				/repairs and completions of the diff you reviewed/u,
			);
		});
	});

	test("a contract contradiction is filed as its own ticket, naming the contract", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt();

			assert.match(rules, /name the ticket it contradicts/u);
			assert.match(rules, /name the ADR/u);
		});
	});

	test("checks for a duplicate before filing a second issue", () => {
		withQueueEnabled(true, () => {
			assert.match(queueRulesForPrompt(), /reference that number instead of/u);
		});
	});

	test("conditions --after on being the batch's last member", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ batch: "audio-seam-work" });

			assert.match(rules, /LAST member/u);
			assert.match(rules, /refuses a tail that moved/u);
		});
	});

	test("an outgrown finding is left unplaced for the human's queue-shaping pass, not gated", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ batch: "audio-seam-work" });

			assert.match(rules, /tail growing faster than the head/u);
			assert.match(rules, /leaving it unplaced for the human's queue-shaping pass/u);
			assert.doesNotMatch(rules, /--gated/u);
		});
	});

	test("registration is the running batch's to take: almost never another batch, never the human array", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ batch: "audio-seam-work" });

			assert.match(rules, /Never the `human` array/u);
			assert.match(rules, /Almost never another batch/u);
			assert.match(rules, /seam-owning case/u);
		});
	});

	test("a crucial follow-up carrying a human question halts, or registers ready-for-human into the batch", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ batch: "audio-seam-work" });

			assert.match(rules, /crucial to the\s+batch landing correctly/u);
			assert.match(rules, /either halt the run/u);
			assert.match(rules, /blocked by mechanism rather than hope/u);
		});
	});

	test("a composed batch leaves placement to the human's queue-shaping pass", () => {
		withQueueEnabled(true, () => {
			const rules = queueRulesForPrompt({ composed: true });

			assert.match(rules, /queue-shaping pass/u);
			assert.doesNotMatch(rules, /--gated/u);
		});
	});

	test("the queue is enabled by default", () => {
		assert.equal(config.queue.enabled, true);
		assert.equal(config.queue.commit, false);
		assert.equal(config.queue.file, "sandcastle.queue.json");
	});
});

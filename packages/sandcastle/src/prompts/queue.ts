/*
 * Queue prompt contract.
 *
 * The review prompts used to hard-code the queue registration rules, which forced every consumer of
 * sandcastle through a queue workflow they may not have. One reader of `queue.enabled` now decides
 * what a review is told; the prompt files only carry the `{{QUEUE_RULES}}` placeholder.
 *
 * This is the sibling of `prompts/skills.ts`: a pure renderer over configuration, so the contract is
 * testable without starting an agent.
 */

import { config } from "../runtime.js";

/** The registration contract a review follows when it finds work beyond its diff's scope. */
const registrationRules = [
	"When this review finds work beyond the diff's scope, register it in the repo's Sandcastle queue",
	"before completion — not just in the comment:",
	"",
	"1. Fix it here when you can. A missing test, an unhandled case, a wrong guard: correct it on",
	"   this branch, re-run validation, and commit it. File a follow-up for work that needs another",
	"   issue's context, a decision this diff cannot make, or more than a review-sized change — a",
	"   review that files what it could have fixed leaves the branch less correct than it found it.",
	"2. File each remaining item as a GitHub issue (`gh issue create`) with the repo's conventional",
	"   title prefix, milestone, labels, and parent/blocker edges per `docs/agents/issue-tracker.md`.",
	"3. Register the new issue with the `sandcastle queue` command group — never by hand-editing the",
	"   manifest:",
	"   - `pnpm sandcastle queue add --issue <N> --sequence <batch>` continues a batch that is still",
	"     running,",
	'   - `pnpm sandcastle queue add --issue <N> --gated --reason "<blocking condition>"` means the',
	"     work cannot start until something else lands,",
	'   - `pnpm sandcastle queue add --issue <N> --human --reason "..."` means it needs a human',
	"     decision session.",
	'   With no batch to join, `--gated --reason "needs a batch"` is the honest placement.',
	"4. Run `pnpm sandcastle queue check` — it must report no drift. If the manifest is git-tracked",
	"   and the repository sets `queue.commit`, the command commits it for you; otherwise commit it",
	"   yourself so the registration reaches the repository instead of dying with this worktree.",
	"5. List the created issue numbers in this comment under `Suggested follow-up issues`.",
	"",
	"A review never lands a batch: `queue run` dispatches, a human runs `queue land` and merges the",
	"pull request it opens, and merging into the base branch stays the human's act.",
	"",
	"The queue is the runnable artifact; the comment is only the report. A review that lists",
	"follow-ups in the comment and stops leaves the queue untouched and the follow-up undispatchable.",
	"",
	"If there are no follow-ups, write `No follow-up issues.` in the review comment instead.",
].join("\n");

/** What the caller knows about the batch a review belongs to. */
export interface QueueRulesContext {
	/** Batch this work belongs to while it is still running, so a follow-up can join its tail. */
	batch?: string;
	/** Whether the batch is already composed; nothing added to it now is in the integration. */
	composed?: boolean;
}

/**
 * The batch paragraph: only a caller that knows the batch can name it, and naming it is what turns
 * "park the follow-up behind a gate" into "continue the work".
 */
function batchRules(context: QueueRulesContext): string {
	if (context.batch !== undefined && context.batch !== "") {
		return [
			`This work is batch "${context.batch}", which is still running, so a follow-up that continues it`,
			"joins that batch:",
			`\`pnpm sandcastle queue add --issue <N> --sequence ${context.batch}\` puts it at the tail.`,
			"Appending to a running batch is expected — `queue run` re-fires the batch, skips the members",
			"that already passed review, and chains their branch as the new member's base. The follow-up",
			"continues this work inside the same invocation, land included.",
		].join("\n");
	}

	if (context.composed === true) {
		return [
			"This batch is already composed, so a follow-up cannot join it: nothing registered against",
			"the queue entry now is in the integration. Register it against another batch, or with",
			'`pnpm sandcastle queue add --issue <N> --gated --reason "<why it waits for this batch to land>"`.',
		].join("\n");
	}

	return "";
}

const disabledRules = [
	"This repository turns the Sandcastle queue workflow off (`queue.enabled: false` in",
	"`sandcastle.config.ts`).",
	"",
	"- Report follow-up work in the issue comment; there is no queue here to write to.",
	"- The manifest stays untouched: no edits, no commits.",
	"- `No follow-up issues.` is still the line to write when nothing was found.",
].join("\n");

/**
 * - Renders the queue rules a review phase must follow, for injection as `{{QUEUE_RULES}}`.
 * - @param context - Batch the review belongs to, and whether that batch is already composed.
 * - @returns The registration contract, or the bypass note when the queue is disabled.
 * - @remarks Repositories without a queue set `queue.enabled: false` and never see a gate they cannot
 *   satisfy. The text is plain prose so it reads correctly in a prompt with no surrounding context,
 *   and the batch paragraph appears only when the caller could name the batch: an unnamed batch is
 *   what pushed reviews into gating follow-ups that belonged in the batch they came from.
 */
export function queueRulesForPrompt(context: QueueRulesContext = {}): string {
	if (!config.queue.enabled) {
		return disabledRules;
	}

	const batch = batchRules(context);
	return batch === "" ? registrationRules : `${registrationRules}\n\n${batch}`;
}

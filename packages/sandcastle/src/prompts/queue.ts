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
	"When this review finds work beyond the diff's scope, file it and register it in the repo's",
	"Sandcastle queue before completion — not just in the comment:",
	"",
	"1. Search the manifest for the files and modules your finding names before you file anything —",
	"   `pnpm sandcastle queue list`, then the member bodies of every batch that mentions them. When",
	"   another batch already has a member doing that exact work, do not file a second ticket:",
	"   reference that member instead. That search is for duplicates, not placement: the follow-up",
	"   belongs in the batch you are running (step 4) — almost never in another batch.",
	"2. Fix it here when you can. A missing test, an unhandled case, a wrong guard: correct it on",
	"   this branch, re-run validation, and commit it. File a follow-up for work that needs another",
	"   issue's context, a decision this diff cannot make, or more than a review-sized change — a",
	"   review that files what it could have fixed leaves the branch less correct than it found it.",
	"   A finding that needs a subsystem the reviewed issue never touched is not a follow-up to this",
	"   issue: it is a new ticket — file it and register it in this batch (step 4), naming the",
	"   subsystem it needs. Follow-ups are repairs and completions of the diff you reviewed.",
	"3. File each remaining item as a GitHub issue (`gh issue create`) with the repo's conventional",
	"   title prefix, milestone, labels, and parent/blocker edges per `docs/agents/issue-tracker.md`.",
	"   The issue must already carry `ready-for-agent` before registration: a member without the",
	"   label reads GATED, and `queue run` stops and names the batch rather than starting unrelated",
	"   work. When your finding — or your fix — would change a contract another ticket owns (a closed",
	"   decision, an acceptance criterion, a documented boundary), do not settle it inside a",
	"   follow-up's body. File the contradiction, name the ticket it contradicts, and say whether",
	"   that ticket is being amended (name the ADR) or the code is wrong. Before filing, search open",
	"   issues for the same title shape; if it already exists, reference that number instead of",
	"   filing a second one.",
	"4. Register it in the same change, into the batch you are running — never by hand-editing the",
	"   manifest: `pnpm sandcastle queue add --issue <N> --sequence <batch> --after <this-issue>`",
	"   chains the follow-up next after this member (valid only when this issue is the batch's LAST",
	"   member; otherwise omit `--after` and append to the tail, which is always safe). `queue run`",
	"   re-reads the batch order before each member, so the follow-up dispatches inside the same",
	"   invocation. The harness refuses an insertion ahead of a member that already ran — that",
	"   member's branch is behind the insertion and `queue land` would refuse the moved tail — and",
	'   names the fix. Add an `R<n>` rule (`pnpm sandcastle queue rule --name R<n> --issues <a,b> --reason "..."`)',
	"   for a new same-file collision.",
	"   These are the only queue writes a review makes. Never the `human` array (grilling",
	"   registrations only). Almost never another batch: cross-batch registration is step 1's",
	"   seam-owning case, and only when that batch is not composed — prefer noting the overlap on",
	"   the existing member. One `ready-for-human` exception: when the follow-up is crucial to the",
	"   batch landing correctly AND carries a question only a human can answer, either halt the run",
	"   and surface the question with the issue reference, or register the `ready-for-human` issue",
	"   into the batch — a member without `ready-for-agent` reads GATED, so the batch stops there,",
	"   blocked by mechanism rather than hope. Halt only when continuing would waste the batch or",
	"   land wrong behavior; one halt per batch.",
	"5. Run `pnpm sandcastle queue check`. Every drift it reports is either fixed by your",
	"   registration or is the unplaced backlog you deliberately left for the human's queue-shaping",
	"   pass — say which in the comment. If the manifest is git-tracked and the repository sets",
	"   `queue.commit`, the command commits it for you; otherwise commit it yourself so the",
	"   registration reaches the repository instead of dying with this worktree.",
	"6. List the created issue numbers in this comment under `Suggested follow-up issues`.",
	"",
	"A deferred-by-design follow-up is APPROVED, not BLOCKED: this branch is right for its scope and",
	"safe to chain once the follow-up is filed, registered, and listed. Reserve BLOCKED for a branch",
	"that is itself wrong and must not chain — a failing test, an unmet criterion with no follow-up,",
	"or a finding left unfixed that belonged on this branch. The batch stops at a BLOCKED member.",
	"",
	"A review never lands a batch: `queue run` dispatches, a human runs `queue land` and merges the",
	"pull request it opens, and merging into the base branch stays the human's act.",
	"",
	"The queue is the runnable artifact; the comment is only the report. A review that lists",
	"follow-ups in the comment and stops leaves the queue untouched, so nothing ever runs the follow-up.",
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
			`\`pnpm sandcastle queue add --issue <N> --sequence ${context.batch}\` appends it to the tail; add \`--after <this-issue>\``,
			"only when this issue is the batch's LAST member, so the follow-up chains this branch next.",
			"Inserting before a member that already ran leaves that member's branch behind the insertion, and",
			"`queue land` then refuses a tail that moved.",
			"Appending to a running batch is expected — `queue run` re-fires the batch, skips the members",
			"that already passed review, and chains their branch as the new member's base. The follow-up",
			"continues this work inside the same invocation, land included.",
			"",
			"A tail growing faster than the head is work being discovered rather than sliced. When your",
			"finding is more than a review-sized change AND touches a module this issue never named, prefer",
			"leaving it unplaced for the human's queue-shaping pass over appending it here — say so in the",
			"comment; `queue check` flags it as drift until placed, which is the honest backlog state.",
			"",
			"The new issue must carry `ready-for-agent` before this review ends: a batch member without it",
			"reads GATED, and `queue run` stops and names the batch rather than starting unrelated work.",
		].join("\n");
	}

	if (context.composed === true) {
		return [
			"This batch is already composed, so a follow-up cannot join it: nothing registered against",
			"the queue entry now is in the integration. File the issue, name the intended batch in its body,",
			"and leave placement to the human's queue-shaping pass — `queue check` flags the unplaced issue",
			"as drift until placed, which is the honest backlog state. Only when another batch demonstrably",
			"owns the seam and is not composed may you register it there (`--sequence <that batch>`), and",
			"say why. A crucial follow-up carrying a question only a human can answer halts the run",
			"instead, surfacing the question with the issue reference.",
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

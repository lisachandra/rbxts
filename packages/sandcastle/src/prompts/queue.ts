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

const enabledRules = [
	"If your review found work beyond this diff's scope, you MUST register it in the repo's",
	"Sandcastle queue before completion — not just list it in the comment:",
	"",
	"1. File each item as a GitHub issue (`gh issue create`) with the repo's conventional title",
	"   prefix, milestone, labels, and parent/blocker edges per `docs/agents/issue-tracker.md`.",
	"2. Register each new issue with the `sandcastle queue` command group — never hand-edit the",
	"   manifest:",
	"   - `pnpm sandcastle queue add --issue <N> --sequence <batch>` when it belongs in an existing",
	"     batch,",
	'   - `pnpm sandcastle queue add --issue <N> --gated --reason "<blocking condition>"` when it',
	"     cannot start yet,",
	'   - `pnpm sandcastle queue add --issue <N> --human --reason "..."` when it needs a human',
	"     decision session.",
	'   When no batch exists yet, use `--gated --reason "needs a batch"` rather than inventing one.',
	"3. Run `pnpm sandcastle queue check` — it must report no drift. If the manifest is git-tracked",
	"   and the repository sets `queue.commit`, the command commits it for you; otherwise commit it",
	"   yourself so the registration reaches the repository instead of dying with this worktree.",
	"4. List the created issue numbers in this comment under `Suggested follow-up issues`.",
	"",
	"A review that lists follow-ups in the comment but leaves the queue untouched is incomplete —",
	"the queue is the runnable artifact; the comment is only the report.",
	"",
	"If there are no follow-ups, write `No follow-up issues.` in the review comment instead.",
].join("\n");

const disabledRules = [
	"This repository does not use the Sandcastle queue workflow (`queue.enabled: false` in",
	"`sandcastle.config.ts`).",
	"",
	"- Report follow-up work in the issue comment only; do not run `sandcastle queue`.",
	"- Do not create, edit, or commit a queue manifest.",
	"- `No follow-up issues.` is still the line to write when nothing was found.",
].join("\n");

/**
 * - Renders the queue rules a review phase must follow, for injection as `{{QUEUE_RULES}}`.
 * - @returns The mandatory registration contract, or the bypass note when the queue is disabled.
 * - @remarks Repositories without a queue set `queue.enabled: false` and never see a gate they cannot
 *   satisfy. The text is plain prose so it reads correctly in a prompt with no surrounding
 *   context.
 */
export function queueRulesForPrompt(): string {
	return config.queue.enabled ? enabledRules : disabledRules;
}

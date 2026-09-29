---
"@lisachandra/sandcastle": minor
---

Prompt contract: one injected completion block, and a review told what to fix

Behaviour changes:

- `{{COMPLETION}}` replaces the completion paragraph that was copied into all six prompt files. It
  is rendered by `src/prompts/completion.ts` with the marker path already interpolated, so no prompt
  has to carry a nested placeholder. `agent.test.ts` fails any prompt file that stops referencing
  it, and `{{MARKER_DIR}}`/`{{MARKER_PATH}}` are no longer prompt arguments.
- The planner is passed only the arguments `plan-all.md` reads (`COMPLETION`, `READY_LABEL`).
  `BASE_REF`, `BRANCH`, `ISSUE_NUMBER`, `ISSUE_TITLE`, `PLAN_PATH`, and `SKILLS` were provided and
  never referenced, which the runner reported on every planning run.
- `review-issue.md` no longer restates the follow-up contract. It named "missing tests" as
  follow-up material ten lines above the injected rule that calls a missing test a fix-here, so the
  file argued with `{{QUEUE_RULES}}`; the injected block is now the only owner of that rule.
- `review-integration.md` gives `{{QUEUE_RULES}}` its own heading instead of indenting it under
  "Run relevant validation after corrections", and states the human-merge rule once.
- `implement-issue.md` asks for the plan once instead of three times, and `plan-all.md` states its
  output rules once; the duplicated closing instructions are gone.
- `docs/skills/sandcastle/SKILL.md` states the `after`-gate truth table's behaviour instead of
  reproducing it — `queue list` prints the state — and compresses the runner's dispatch guarantees.

# Task

Review the complete Sandcastle integration `{{INTEGRATION_NAME}}` before human merge.

## Environment

{{SETUP_NOTE}}

## Required skills

Use these skills when available:

{{SKILLS}}

## Required context

- Read `AGENTS.md` and the relevant project standards.
- Read the integration manifest and source metadata below.
- Inspect the complete diff with `git diff {{BASE_COMMIT}}...HEAD`.
- Inspect the merge history so interactions between source groups are reviewed, not just each source in isolation.

Base: `{{BASE_REF}}` (`{{BASE_COMMIT}}`)
Branch: `{{BRANCH}}`
Sources:

```json
{{SOURCES}}
```

## Review checklist

- Find behavioral regressions and conflicts introduced by combining the sources.
- Check source boundaries, duplicated or incompatible changes, and validation gaps.
- Follow repository coding standards and preserve the scope of the selected sources.
- Fix findings directly on this branch when a safe correction is clear.
- Commit every correction with a Conventional Commit message, and re-run the relevant validation after it.
- Run validation in its checking form on this branch, once per batch: `pnpm lint`, `pnpm typecheck`, `pnpm test`, as the repository defines them — detached with a log, then polled. Where `AGENTS.md` lists a write-mode command among its verification steps (`lint:fix` and the like), use the checking form here instead. Report each command, its wall time, and the tail with the review.
- Never run a command that rewrites tracked files (`lint:fix`, a formatter, a build that regenerates sources) across the whole repository here. This worktree outlives the batch, so whatever it leaves modified is what the next merge refuses: `git merge` aborts with "local changes would be overwritten". If a formatter genuinely must run, pass it the paths this review changed and commit the result with the correction it belongs to — committing unrelated churn pollutes the batch just as badly, because the next reviewer cannot tell your formatting from a source's work.
- Check the composed batch against the closed contracts its members cite, and against every other batch's membership. A batch that grew into another batch's subsystem is a finding at this phase even when every member passed its own review.

This is the final combined review. Individual issue or integration reviews do not replace it. Leave the branch ready for a human to merge: every correction committed, no conflict markers, no merge in progress. Merging it into the base branch is the human's act.

## Follow-up issues

{{QUEUE_RULES}}

## Completion

{{COMPLETION}}

# Task

Review the complete Sandcastle integration `{{INTEGRATION_NAME}}` before human merge.

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
- Run the repository's full validation suite on this branch, once per batch: detached with a log, then polled. Report the command, the wall time, and the tail with the review.
- Check the composed batch against the closed contracts its members cite, and against every other batch's membership. A batch that grew into another batch's subsystem is a finding at this phase even when every member passed its own review.

This is the final combined review. Individual issue or integration reviews do not replace it. Leave the branch ready for a human to merge: every correction committed, no conflict markers, no merge in progress. Merging it into the base branch is the human's act.

## Follow-up issues

{{QUEUE_RULES}}

## Completion

{{COMPLETION}}

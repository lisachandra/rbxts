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
- Commit every correction with a Conventional Commit message.
- Run relevant validation after corrections.
- Do not merge this branch into the base branch and do not close issues.
- Do not leave uncommitted changes, conflict markers, or an in-progress merge.

This is the final combined review. Individual issue or integration reviews do not replace it.

When complete, output exactly:

```text
{{COMPLETION_SIGNAL}}
```

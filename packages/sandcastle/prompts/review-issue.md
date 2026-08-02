# Task

Review the Sandcastle implementation branch for GitHub issue #{{ISSUE_NUMBER}}.

You are the reviewer. The implementer was an agent working from a plan; you have the full context plus `AGENTS.md` and the project's ADRs at your disposal. Be thorough.

## Required skills

Use these skills when available for this phase:

{{SKILLS}}

Treat them as guidance; repository instructions, issue acceptance criteria, and validation requirements remain authoritative.

## Required context

1. Read `AGENTS.md` and relevant files.
2. Fetch the issue with `gh issue view {{ISSUE_NUMBER}} --comments`.
3. Read the designer's plan at `{{PLAN_PATH}}`.
 4. Inspect the diff: `git diff {{BASE_REF}}...HEAD`

## Review checklist

### Plan adherence

- Did the implementer build what the plan specified? Walk each slice in `{{PLAN_PATH}}` and confirm a matching test plus implementation landed.
- Are non-goals respected? Flag any code added that the plan said NOT to add.
- Are the plan's open questions resolved? If the plan flagged a decision the designer couldn't make, decide it now.
- If the implementer skipped, misread, or partially completed a slice, fix it.

### Standards compliance

- The change addresses only issue #{{ISSUE_NUMBER}}.
- The issue was narrow enough for AFK implementation.
- Repo conventions in `AGENTS.md` and relevant files were followed.
- Tests or validation were run and reported.
- No release was cut.
- No broad roadmap work or unrelated refactor slipped in.
- Commit messages must use Conventional Commits.

## GitHub issue comment

Leave a concise review summary as a comment on the issue with:

- a machine-readable status line, exactly `Sandcastle-Review: APPROVED` or `Sandcastle-Review: BLOCKED`,
- risks,
- missing validation,
- suggested follow-up issues.

The status line must be on its own line. Do not use `BLOCKED` in prose as a substitute for this marker.

Do not close the issue. Do not claim merge/closure.

## Final response

End by outputting exactly:

```text
{{COMPLETION_SIGNAL}}
```

# Task

Review the Sandcastle implementation branch `{{BRANCH}}` for GitHub issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}.

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
- Findings that spawn new work (bugs, scope gaps, missing tests) must be registered as
  follow-up issues AND registered in the Sandcastle queue — see
  "Follow-up issue registration" below. Do not stop at listing them in the review comment.

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
- suggested follow-up issues, each filed AND registered via `sandcastle queue add` (see below).

## Follow-up issue registration (mandatory when follow-ups exist)

If your review found extra issues beyond this diff's scope, you MUST register them in the
repo's Sandcastle queue before completion — not just list them in this comment:

1. File each follow-up as a GitHub issue (`gh issue create`) with the repo's conventional
   title prefix, milestone, labels, and parent/blocker edges per the repo's issue-tracker doc.
2. Register each new issue in the Sandcastle queue — the runnable artifact — with the
   `sandcastle queue` command group (never hand-edit a queue markdown doc):
   `sandcastle queue add --issue <N> --sequence <existing batch>` when it belongs in an
   existing batch, `sandcastle queue add --issue <N> --gated --reason "<blocking condition>"`
   when it cannot start yet, or `--human --reason "..."` when it needs a human decision
   session. Then run `sandcastle queue check` — it must report no drift.
3. List the created issue numbers in this review comment under `Suggested follow-up issues`.

A review that lists follow-ups in the comment but leaves the queue untouched is incomplete —
the queue is the runnable artifact; the comment is only the report.

If there are no follow-ups, write `No follow-up issues.` in the review comment instead.

The status line must be on its own line. Do not use `BLOCKED` in prose as a substitute for this marker.

Do not close the issue. Do not claim merge/closure.

## Completion

When every required step above is finished, create the completion marker as your final action:

```
mkdir -p "{{MARKER_DIR}}" && touch "{{MARKER_PATH}}"
```

Do not create the marker before finishing. Do not output a completion token or the marker path in your final response.

Before creating the marker, make sure any processes you spawned have exited or been terminated. After the marker is created, do not spawn or wait on any subprocesses or background jobs — stop immediately.

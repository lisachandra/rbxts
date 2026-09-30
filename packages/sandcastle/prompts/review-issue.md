# Task

Review the Sandcastle implementation branch `{{BRANCH}}` for GitHub issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}.

You are the reviewer. The implementer was an agent working from a plan; you have the full context plus `AGENTS.md` and the project's ADRs at your disposal.

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

- Walk every slice in `{{PLAN_PATH}}` and confirm a matching test plus implementation landed, or say in the comment why it could not.
- Are non-goals respected? Flag any code added that the plan said NOT to add.
- Are the plan's open questions resolved? If the plan flagged a decision the designer couldn't make, decide it now.
- If the implementer skipped, misread, or partially completed a slice, fix it on this branch.
- Correct every finding whose fix is small, safe, and inside this issue's blast radius — a missing test, an unhandled case, a wrong guard, a stale doc line — then re-run validation and commit it. A review that files what it could have fixed leaves the branch less correct than it found it.
- Register what is left over: "Follow-up issue registration" below is the contract, and a finding listed only in the comment does not count as registered.

### Standards compliance

- The change addresses only issue #{{ISSUE_NUMBER}}.
- The issue was narrow enough for AFK implementation.
- Repo conventions in `AGENTS.md` and relevant files were followed.
- Tests or validation were run and reported.
- No release was cut.
- No broad roadmap work or unrelated refactor slipped in.
- Commit messages must use Conventional Commits.

## Verdict

`APPROVED` means the branch is right: acceptance criteria met, owed checks green, and every finding you could fix committed. `BLOCKED` means the branch is wrong: a failing test, an unmet criterion, a finding left unfixed.

A check you cannot finish inside your budget is neither one. Run the largest honest part of it, then report the command, its wall time, and what stayed unverified — the operator decides the merge, and the comment is where that gap is visible.

Suites a repo documents as slow (its `AGENTS.md` carries the number) start detached and are polled: `<command> > .tmp/<name>.log 2>&1 &`, then read the log. A kill at your harness's default timeout is a missing run, not a failing one.

## GitHub issue comment

Leave a concise review summary as a comment on the issue with:

- a machine-readable status line, exactly `Sandcastle-Review: APPROVED` or `Sandcastle-Review: BLOCKED`, on its own line,
- risks,
- missing validation, each entry naming the command, its wall time, and what stayed unverified,
- the follow-up issue numbers you registered.

`BLOCKED` is only the status line; prose never substitutes for it. The issue stays open — the integration pull request's `Closes` line is what closes it.

## Follow-up issue registration

{{QUEUE_RULES}}

## Completion

{{COMPLETION}}

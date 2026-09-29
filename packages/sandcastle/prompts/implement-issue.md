# Task

Implement GitHub issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}} on branch `{{BRANCH}}`.

This is a Sandcastle no-sandbox run: you are operating on the host machine in a dedicated git branch/worktree.

## Required skills

Use these skills when available for this phase:

{{SKILLS}}

Treat them as guidance; repository instructions, issue acceptance criteria, and validation requirements remain authoritative.

## Context

1. Read `AGENTS.md` and relevant files.
2. Fetch the issue with `gh issue view {{ISSUE_NUMBER}} --comments`.
3. Read the designer's plan at `{{PLAN_PATH}}` — it is canonical, and the reviewer reads it next, so leave the file exactly as the designer wrote it.
4. Inspect the diff: `git diff {{BASE_REF}}...HEAD`

Follow the plan's slice breakdown. Pull the issue (`gh issue view {{ISSUE_NUMBER}}`) or parent PRD only if you need detail the plan does not cover.

## Exploration

Explore the sibling code and test files the plan points at. Pay extra attention to test files that touch the relevant parts of the code.

## Execution

Use TDD red-green-refactor per the plan's slice breakdown:

1. RED: write one failing test for the slice.
2. GREEN: write the minimum implementation to pass it.
3. Commit RED + GREEN together.
4. REFACTOR if it adds value for that slice, then commit the refactor separately.
5. Repeat for the next slice.

Every line of production code in a commit must be exercised by a test in that same commit. No premature scaffolding.

## Validation

Before each commit, follow AGENTS.md verification policies.

If the build produces pre-existing errors in unrelated files, note them but do not fix them.

## GitHub issue updates

When done, add a concise issue comment with:

- summary of changes,
- validation command and result,
- blockers or follow-up work,
- branch name.

The issue stays open — the integration pull request's `Closes` line is what closes it.

## Commit

If files changed, make one or more focused commits, each with a Conventional Commits message.

## Completion

{{COMPLETION}}

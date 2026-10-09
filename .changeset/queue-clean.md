---
"@lisachandra/sandcastle": minor
---

Add `queue clean` to prune worktrees and integrations

Nothing else in the command group removed `.sandcastle/worktrees/sandcastle-issue-<n>`, so issue and
integration worktrees accumulated forever. `queue clean` is the one place that answers "what is safe
to delete?", from live GitHub state plus the queue manifest rather than from file timestamps:

- `--closed` an issue whose GitHub issue is closed, `--landed` a member whose review is APPROVED,
  `--stale` a worktree with no manifest placement and no live issue, `--integration-worktrees` a
  composition that reached a terminal status, `--all` every one of those.
- `--drop-branch` also deletes the `sandcastle/issue-<n>` branch, `--reset` drops a terminal
  integration's worktree, branch, and manifest so it can be composed again, `--force` removes a
  worktree that is dirty or mid-merge, and `--dry-run` / `--json` report the plan first.

It keeps any worktree that is still open and unapproved — cleaning is never a way to cancel work by
accident — and never touches the primary checkout. Only `sandcastle/issue-<n>` branches at the
runner's own worktree path are candidates, so a hand-made worktree is left alone.

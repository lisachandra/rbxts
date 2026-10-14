---
"@lisachandra/sandcastle": minor
---

Add `queue clean --push-and-delete`

An issue worktree could only be removed, never handed off: nothing in the runner pushes
`sandcastle/issue-<n>`, so deleting the worktree was the last copy of the branch's working tree and
the branch stayed local.

- `queue clean --push-and-delete` pushes each selected issue branch to `origin` (`git push -u
origin <branch>`) and only then removes its worktree, so a failed push leaves the worktree in
  place. The local branch survives unless `--drop-branch` is also given.
- Issue worktrees only, deliberately. An integration branch is pushed by `queue land --create-pr`,
  and a landing is already the hand-off, so the flag is refused alongside `--integration-worktrees`
  rather than quietly doing nothing for integrations.
- Reported in the plan and suppressed by `--dry-run`, like every other removal here.

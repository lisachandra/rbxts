---
"@lisachandra/sandcastle": patch
---

Stop re-creating a skipped member's worktree, and let a cleaned branch resolve

A batch re-fired after `queue clean` re-created a full checkout for **every** member it only meant to
skip, which undid the cleanup that asked for it. The skip path needs the branch, not the worktree: the
next member is cut from the branch, so nothing there reads the worktree. The recreation is gone.

- A member whose branch survives only on `origin` now counts as landed. `branchTip` resolves
  `refs/heads/<b>` and then `refs/remotes/origin/<b>`, and `ensureLocalBranch` tracks the local branch
  from the remote before it is used as a chain base. This is the hole a cleanup opens itself: push the
  branch, drop the local copy, and a local-only check would re-run work that is safe on the remote.
  `queue land`'s drift check reads a branch head the same way, so a pushed-then-dropped member still
  resolves for `staleComposition`.
- The issue worktree root now resolves against `stateRoot` like every other state path. It was the one
  path still rooted at `process.cwd()`, which made `queue clean` run from inside a linked worktree
  treat every registered worktree as foreign and silently keep all of them.

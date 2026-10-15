---
"@lisachandra/sandcastle": minor
---

Reclaim a finished member's worktree immediately, and clean `.git` on demand

Worktrees accumulated with nothing to remove them: `queue clean` was repo-wide and manual, and
nothing pushed a member's branch, so deleting a worktree could be the last copy of the work.

- `queue run --push-and-delete` pushes each member's branch and removes its worktree **as that
  member finishes**, not at batch or land time. The chain base is the previous member's branch
  (`sequential.ts` chains `nextBase = branchName`) and `queue land` merges a source's commit into its
  own integration worktree, so nothing downstream reads a member's worktree — a 31-member batch
  otherwise holds 31 full checkouts, each carrying whatever `setupCommands` installed.
- Two guards, both deliberate: a member with uncommitted tracked paths keeps its worktree, because a
  review can leave corrections that exist nowhere else, and a failed push keeps it, because the push
  is what makes the worktree disposable. Neither is fatal — the member already finished.
- `queue clean --batch <name>` narrows the selection to one batch's members, which is how a batch run
  before this change gets reclaimed. A `--batch` naming no sequence fails loudly rather than cleaning
  nothing.
- `queue clean --prune-git` sweeps worktree registrations whose directory is gone, the debris a
  hand-deleted worktree leaves in `.git/worktrees`. It removes no worktree, and git decides what is
  prunable: a locked worktree's registration is git's to keep, which a hand-rolled sweep would delete.
  Every removal now prunes, not just the Windows `rmdir` path.

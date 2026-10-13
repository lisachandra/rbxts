---
"@lisachandra/sandcastle": patch
---

Unlink a worktree's linked dirs before removing it

`git worktree remove` walks directory junctions instead of unlinking them, so removing a worktree
emptied the **target** of every linked dir and then failed with `failed to delete '…': Directory not
empty`. In the wild that destroyed the primary checkout's `.sandcastle/plans` when an integration
worktree was reset: the plans were gitignored, so there was no git copy to restore from.

- New `removeWorktree` unlinks the links this runner created and only then calls git. It is now the
  only removal path: `resetIntegration`, `cleanupIntegration`, and both `queue clean` sites.
- New `unlinkWorktreeLinks` sweeps the runner's own surface — configured `symlinks`, worktree-root
  entries, and `config.dir` children — and never walks the tree, because vendored submodules carry
  real symlinks of their own that are tracked content, not links to prune. It also catches a link
  that a stale config no longer lists.
- `resetIntegration` no longer writes `aborted` / "Reset so the composition can be rebuilt from its
  sources." before it has removed anything. A failed removal now records the real error instead of
  claiming a reset that did not happen — the message that made the original incident hard to read.
- Covered by a real-repository regression test (real git, real junctions) plus a baseline test that
  pins git's destructive behaviour, so the unlink sweep can be reconsidered if git ever changes.

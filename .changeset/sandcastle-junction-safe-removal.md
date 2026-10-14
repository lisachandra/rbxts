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
- New `unlinkWorktreeLinks` sweeps the **whole tree** and unlinks every link it finds, never following
  one. A root-and-state-dir-only sweep found 3 of roughly 12,000 links in the field, and the ones it
  missed — under `.workspace-links/**`, `.vscode/**`, and `node_modules/**` — are exactly what a
  recursive removal follows out of the worktree. A partial sweep is not a smaller fix, it is an
  unfixed one. Symlinks are unlinked as links and never traversed, so vendored submodule links go
  with the worktree and their targets are untouched.
- `resetIntegration` no longer writes `aborted` / "Reset so the composition can be rebuilt from its
  sources." before it has removed anything. A failed removal now records the real error instead of
  claiming a reset that did not happen — the message that made the original incident hard to read.
- Covered by a real-repository regression test (real git, real junctions) — including links nested
  outside the runner's own surface — plus a baseline test that pins git's destructive behaviour, so
  the unlink sweep can be reconsidered if git ever changes.

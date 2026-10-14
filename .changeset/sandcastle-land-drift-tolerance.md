---
"@lisachandra/sandcastle": minor
---

Land a composition whose review left uncommitted changes

`queue land` failed the whole hand-off when the integration review left edits in the worktree —
`Integration review left uncommitted changes; commit review corrections before handoff.` The review
agent routinely leaves formatting and scratch edits behind, so the failure was routine, and it left
the integration `review-failed` with no pull request. That is what `audio-seam-work` hit: composed,
reviewed, and then stuck at `aborted` with nothing to merge.

- Landing composes with drift tolerance on. The tracked leftovers are stashed through the existing
  `quarantineWorktreeDrift` helper and recorded on the manifest, so the hand-off completes and the
  changes are still recoverable with `git stash apply`. Untracked leftovers are reported, not fatal.
- `manifest.drift` now accumulates instead of being overwritten. A composition can quarantine twice
  — once before a merge and again after the review — and each stash commit was the only pointer to
  the work it held, so the second quarantine used to drop the first one's location. Older manifests
  that carry a single `stashCommit` still read correctly.
- `integration-status` prints every stash, oldest first, instead of only the newest.

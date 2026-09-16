---
"@lisachandra/sandcastle": minor
---

Stop integration composition from dying on uncommitted worktree drift

Integration worktrees are long-lived and shared, so setup commands (`fetch-places`, submodule
checkouts, generated files) and agent validation runs (`lint:fix`, builds, tests) regularly
leave tracked files modified. When a source branch also touched one of those files, `git merge`
aborted with "Your local changes to the following files would be overwritten by merge" —
a message the conflict resolver cannot act on, and which the runner reported as
`conflict-resolution-required`, so every resume replayed the same failure.

- `integrateManifestSource` now pre-flights the worktree with `git status` before merging.
  Without the new flag it fails fast, naming the blocking paths and the remedy, and the manifest
  records the new `blocked` status (only genuine unmerged paths map to
  `conflict-resolution-required`).
- New `--quarantine-drift` flag on `merge`, `merge-integrations`, and `integration-resume`
  stashes the blocking paths (`git stash push -m "sandcastle <name>: pre-merge drift"`) and
  records the resulting stash commit on the manifest (`.drift`), so nothing is lost and the
  operator can restore it with `git stash apply <commit>`.
- `integration-status` prints the quarantined paths plus the restore command.
- Submodule gitlinks are reported but never treated as blockers: git merges over them, as
  `pnpm setup` / `pnpm submodules` routinely leave them dirty.
- Untracked files are ignored throughout, because worktree symlinks (`.agents`, `.diracrules`,
  `creator-docs`, `.sandcastle/plans`) must never be quarantined.

New helpers: `dirtyPaths`, `changedSinceMergeBase`, and `isGitlink` in `git.ts`;
`partitionDrift`, `quarantineWorktreeDrift`, and `prepareWorktreeForMerge` in `integrations.ts`.

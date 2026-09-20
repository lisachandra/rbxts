---
"@lisachandra/sandcastle": patch
---

Internal refactor: split integration composition into deep, testable modules

The integration subsystem previously lived as a single `integrations.ts` monolith mixing
manifest CRUD, worktree preparation, git merge plumbing, conflict helpers, and the
`continueIntegration` state machine. This change extracts three cohesive modules behind clean
seams with zero wire-format, schema, branch-naming, marker, or CLI changes:

- `integration/manifest.ts` owns the manifest lifecycle: path resolution, validation, JSON
  read/write, and creation, with an injectable `ManifestFs` and source-resolution helpers.
- `integration/merger.ts` owns the git merge contract: clean-resolution assertions, drift
  handling (`quarantineWorktreeDrift`, `prepareWorktreeForMerge`), and the per-source merge
  loop (`integrateManifestSource`), gated behind an injectable `MergerDeps` seam.
- `integration/orchestrator.ts` owns the state machine for `continueIntegration` plus the
  lifecycle commands (`runNewIntegration`, `resumeIntegration`, `printIntegrationStatus`,
  `abortIntegration`, `cleanupIntegration`) and the marker-backed agent phases, delegating
  worktree preparation to the shared `setupWorktree`.

`integrations.ts` is now a thin backwards-compatible barrel re-exporting the three modules;
`main.ts` and every existing caller keep the same import surface unchanged.

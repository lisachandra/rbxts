# @lisachandra/sandcastle

## 0.6.0

### Minor Changes

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Add per-step agent/model/effort overrides for every agent-driven step
  (`design`, `implement`, `review`, `planner`, `resolve`, `integrationReview`).

  - `sandcastle.config.ts`: `agents.steps.<step>` accepts `{ backend, model, effort }`;
    missing fields inherit the workflow default (`--agent` / `--model` / `--effort`
    plus `agents.models`).
  - CLI: `--<step>-model`, `--<step>-agent`, `--<step>-effort` flags (for example
    `--design-model`, `--implement-agent`, `--review-effort`, `--planner-model`,
    `--resolve-model`, `--integration-review-model`).
  - Precedence is CLI flag over `agents.steps` config over the workflow default.
    When a step selects a different backend without its own model, the mapped
    `agents.models[backend]` wins over the workflow model.
  - Issue runs thread `steps.design` / `steps.implement` / `steps.review` through
    design, implement, and review, persist them as `phasesConfig` in
    `.sandcastle/state/<issue>.json`, and re-evaluate the implement phase against
    its own model. `runAll` uses `steps.planner`; integrations use `steps.resolve`
    and `steps.integrationReview`. `--dry-run` and `--status` report the resolved
    per-step map.

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Stop integration composition from dying on uncommitted worktree drift

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

- [`7fdcb7a`](https://github.com/lisachandra/rbxts/commit/7fdcb7aff7dd1e1dc814c70726a8c5c6b00e9646) Thanks [@lisachandra](https://github.com/lisachandra)! - Add a standalone `sandcastle setup` command that prepares a worktree for agent runs
  from `sandcastle.config.ts` without starting an agent. It creates the runner's state
  directories (`.sandcastle/{worktrees,logs,plans,state,integrations}`), copies the repo
  `.env` when present, runs the configured `setupCommands`, and links configured
  `symlinks` — the same preparation issue and integration runs perform implicitly.

  The command is config-driven and idempotent:

  - `sandcastle setup` — prepare the current directory (e.g. a clean paseo worktree)
  - `sandcastle setup --worktree <path>` — prepare an existing worktree path
  - `sandcastle setup --branch <name> [--base <ref>]` — create/reuse a registered worktree
    under `.sandcastle/worktrees/` and prepare it
  - `--ignore-setup` / `--skip-setup` / `--dry-run` behave like the issue workflow flags

  The `.env` copy and symlink linking moved into the shared `setupWorktree` helper, so
  supplied (`--worktree`) issue runs and integration worktrees get consistent preparation.

### Patch Changes

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Internal refactor: split integration composition into deep, testable modules

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

- [`5ab96f3`](https://github.com/lisachandra/rbxts/commit/5ab96f35ea20589bf4c3cc7965caf17e74d31877) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix `linkSymlinks` failing to link junctions whose parent directory does not exist.

  On Windows, `symlinkSync(..., "junction")` throws `ENOENT` when the link's parent
  directory is missing. For `symlinks` entries nested under gitignored paths (e.g.
  `.sandcastle/plans`), `git worktree add` never creates the parent, so every fresh
  worktree failed to link the plans junction — the agent then wrote plan files into a
  real `<worktree>/.sandcastle/plans` directory that looked correct but was not shared
  with the repo.

  `linkSymlinks` now creates the parent directory before linking, and when a real
  directory already occupies the link path (a plan agent's drifted `plans/`), it
  replaces the directory with a junction while preserving its contents into the target.
  Re-running `sandcastle setup` on an affected worktree repairs the junction without
  losing any plans already written by agents.

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix log timestamps and dirac effort handling.

  - Log `Run started` markers now pair the UTC timestamp with local wall-clock
    time (`2026-09-06T00:00:00.000Z (local: 2026-09-06 07:00:00 GMT+07:00)`), so
    operators in timezones like GMT+7 see their wall clock. Stored state
    timestamps stay UTC ISO for machine comparison.
  - Effort `max` is forwarded untouched to dirac (`--reasoning-effort max` —
    dirac natively supports it via `OPENAI_REASONING_EFFORT_OPTIONS`) instead of
    being downgraded to `xhigh` with a bogus warning. The `max` to `xhigh`
    mapping (and warning) is kept only for backends that genuinely cap at
    `xhigh` (`pi`, `codex`).

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Simplify agent logs back to one live file, plus a dirac-only digest.

  - `.log` files are plain upstream file-mode logs again (`FileDisplay` output
    with `verbose: true`, matching pre-split behavior). The split-file
    machinery (`splitFileLogging`, `postProcessAgentLog`, `.raw.log`,
    `.readable.log`) is removed; leftover `.raw.log` / `.readable.log` files
    from earlier runs can be deleted.
  - Dirac runs additionally stream a clean markdown digest
    (`issue-<n>.dirac.log`, same rendering as the old `.readable.log`) live as
    agent events arrive, so the readable output exists from run start and
    survives failures — no more waiting for an end-of-run post-process step.

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Modularize the agent-provider bundle and unify issue-metadata fetching.

  - Each agent backend (`pi`, `codex`, `dirac`, `cursor`, `copilot`, `opencode`,
    `claude-code`) is now an adapter module under `src/providers/`, keeping its
    argument mapping and effort constraints localized. `createAgent` and
    `resolveBackendEffort` remain the single public entry point and still wrap
    every provider with the marker-completion proxy.
  - `withMarkerCompletion` moved to `src/providers/marker.ts`; `skillsForPrompt`
    and `uniqueSkills` moved to `src/prompts/skills.ts`.
  - New `issueMetadata(issueNumber, gh?)` seam in `src/issue-metadata.ts` is the
    single owner of the `gh issue view` title/label fetch (injectable `gh` runner,
    defaulting to `io.execSync`). `issue.ts` and `status.ts` now call it directly
    instead of re-implementing the shell fetch. `issueView` and
    `fetchIssueLabels` remain exported for backwards compatibility.

  No CLI arguments, config schemas, prompt files, wrapper scripts, or the marker
  protocol line change.

## 0.5.0

### Minor Changes

- Run the same worktree preparation used by issue runs (`.env` copy, `setupCommands`, and
  `symlinks`) before integration merge/resume agents start. `--ignore-setup` and `--skip-setup`
  now apply to `merge`, `merge-integrations`, and `integration-resume` as well.

## 0.4.0

### Minor Changes

- Add `--skip-setup` to skip the configured setup commands for issue, issue-all, and
  issue-sequence runs while still linking configured symlinks.

### Patch Changes

- `--ignore-setup` now links configured symlinks even when the setup command fails, instead of
  skipping the remainder of the setup step.

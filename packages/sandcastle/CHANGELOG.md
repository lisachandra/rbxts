# @lisachandra/sandcastle

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

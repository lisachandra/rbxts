# @lisachandra/sandcastle

## 0.4.0

### Minor Changes

- Add `--skip-setup` to skip the configured setup commands for issue, issue-all, and
  issue-sequence runs while still linking configured symlinks.

### Patch Changes

- `--ignore-setup` now links configured symlinks even when the setup command fails, instead of
  skipping the remainder of the setup step.

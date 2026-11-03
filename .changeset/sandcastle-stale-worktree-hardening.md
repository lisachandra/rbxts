---
"@lisachandra/sandcastle": minor
---

Harden persistent worktrees against stale bases and silent setup failures

Persistent issue worktrees are reused across runs without ever moving their
branch, so a branch cut days ago can run its phases and setup commands against
a base that has long moved on — #498 burned its whole phase budget on an
install bug main had already fixed, three commits behind.

- New `countStaleCommits` git helper measures the behind direction
  (`HEAD..base`), and `runSingleIssue` warns when a worktree lags its base.
- `ensurePersistentWorktree` says what base it is actually reusing a branch
  against: reusing an existing branch as-is drops the requested base on the
  floor, so a reused stale member now logs how far it lags instead of only
  surfacing later as a failed install.
- `prepareIssueWorktree` rebases a clean, registered worktree onto its base
  before setup runs (dirty trees, conflicts, and non-worktree paths are left
  untouched with a warning). Opt out with `SANDCASTLE_AUTO_REBASE=0`.
- A setup failure continued past under `--ignore-setup` is no longer swallowed:
  `setupWorktree` returns the flattened error and the runner injects it into
  every phase prompt as `{{SETUP_NOTE}}`, so the agent is told the environment
  may be broken instead of rediscovering it by spending its budget on free
  diagnostic work.

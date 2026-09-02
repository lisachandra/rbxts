---
"@lisachandra/sandcastle": minor
---

Add a standalone `sandcastle setup` command that prepares a worktree for agent runs
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

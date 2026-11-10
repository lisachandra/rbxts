---
"@lisachandra/sandcastle": minor
---

Log `setupCommands` output instead of inheriting it on agent runs

`setupWorktree` ran the setup command with `stdio: "inherit"`, so every install line landed in
whatever terminal or log the caller owned. On a repository whose setup fetches places, checks out
submodules, or builds the world, that is thousands of lines before the first phase prints
anything — and the run's own progress scrolls out of reach.

- Agent paths (`issue`, `issue all`, `issue-sequence`, `merge`, `merge-integrations`,
  `integration-resume`, `queue run`, `queue land`) now append setup stdout and stderr to a
  per-worktree log: `.sandcastle/logs/setup-issue-<worktree>.log` or
  `setup-integration-<name>.log`, with a `--- Setup started ---` header carrying the command and
  cwd, and rotation to `.1` past 5 MiB. The terminal gets one announcing line before the command
  and one summary with the duration and path after it.
- A failed hidden setup prints the last 30 log lines before rethrowing, and `--ignore-setup`'s
  `SETUP_NOTE` cites the log path. A redirected child's error carries only
  `Command failed: <cmd>`, so without the tail a failed setup would point at a file and stop
  there.
- `stdin` is ignored in `log` mode: a setup command waiting on a prompt fails instead of hanging
  an unattended run.
- `--setup-output <inherit|log>` on every command that can run setup, plus `setupOutput` in
  `sandcastle.config.ts`. Precedence is flag, then config, then the command default: `log` for
  agent runs, `inherit` for a standalone `sandcastle setup` where a human is waiting on the
  output.
- If the log cannot be opened, the runner warns and falls back to `inherit` rather than failing
  an environment over logging.
- Under `--json`, setup's human lines go to stderr, so `queue run --json` no longer has setup
  chatter mixed into its JSONL on stdout.

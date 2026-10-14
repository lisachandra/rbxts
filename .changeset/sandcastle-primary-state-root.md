---
"@lisachandra/sandcastle": patch
---

Resolve the runner's state paths against the primary checkout

Every state path — `logsDir`, `plansDir`, `stateDir`, `integrationsDir`, and the markers directory —
derived from `process.cwd()`, while only the queue manifest redirected to the primary checkout. An
agent whose cwd was a worktree therefore minted state inside that worktree. In the incident that
surfaced this, a designer ran `mkdir -p .sandcastle/markers && touch
.sandcastle/markers/341.design.completed` with cwd set to the worktree, and the runner then failed
with `completion marker not found at <primary checkout>/.sandcastle/markers/341.design.completed`: the
worktree had the marker, the runner looked in the checkout that owned the run.

- New `stateRoot` resolves through git: a linked worktree reports the same `.git` common directory as
  its primary checkout, and its own toplevel is not that directory's parent, so that difference is
  what redirects. A run from the checkout itself, or from a subdirectory of it, is unchanged —
  deliberately, since the runner is normally invoked from the repository root.
- `repoRoot` still means the process working directory, so `inPrimaryWorktree()` keeps its meaning.

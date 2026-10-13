---
"@lisachandra/sandcastle": minor
---

Commit an issue's plan onto its branch

The plan was written into a gitignored directory, so it existed only on the machine that ran the
design phase: a worktree removal took it with them (see the junction fix in this release), and a
later batch member chaining the branch had nothing to read.

- The design phase commits `dir/plans/<issue>.md` on the issue branch, best-effort and staged by its
  own path so an agent's unrelated dirty edits are never swept in. A repo that keeps plans gitignored
  no-ops silently, exactly as before.
- `countNewCommits` now excludes the plans path. Without that, the design phase's own commit would
  make a plan-only branch read as implemented work and start a review of nothing — `has commits` has
  to keep meaning `has implementation`.
- `evaluateDesign` / `evaluateImplement` prefer the worktree's plan over the primary checkout's. The
  branch copy is the authority on what the issue was designed to do; a leftover file in the main
  checkout must not shadow it. The repo-root copy still answers when no worktree copy exists yet.

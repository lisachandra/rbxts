---
"@lisachandra/sandcastle": patch
---

Fix `linkSymlinks` failing to link junctions whose parent directory does not exist.

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

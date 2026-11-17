---
"@lisachandra/sandcastle": patch
---

Judge an integration's hand-off by what the branch carries, not by raw `git status`

A composition could not finish: `integration-resume` failed with "Integration review left uncommitted
changes" on a worktree whose only dirt was an untracked `pnpm-lock.yaml` inside
`submodules/nexus-sync`, a file `pnpm setup` itself creates. The review's correction was already
committed, so every retry re-ran the whole review agent — a full budget each time — to fail on the same
surviving path.

The gate and the classifier disagreed by construction: the gate read raw `git status --porcelain`, while
`partitionDrift` used `--untracked-files=no` and suppressed exactly that state, so one function said
"block" and the other "clean".

- `partitionDrift` is now the single definition of drift. It classifies tracked edits and moved
  submodule pointers as blocking, submodule content dirt as noise, and untracked paths as
  branch-invisible. The new `submodulePointerMoved` compares the recorded gitlink with the checked-out
  commit, so a branch that re-points a submodule still blocks.
- The hand-off gate consumes it, and quarantines post-review dirt unconditionally: that dirt is agent
  churn by construction. `quarantineDrift` keeps its meaning where it belongs — the pre-merge phase,
  where the dirt may be a human's in-flight work.
- `reviewHead` records the tip a review approved, so a resume that finds `HEAD` unchanged skips the
  agent pass instead of spending another budget to reach the same commit.
- Both integration prompts now receive `SETUP_NOTE`. `continueIntegration` had discarded the error
  `prepareIntegrationWorktree` returns, so a review ran blind against a broken environment. The
  formatter moved to `prompts/setup-note.ts` so the issue and integration paths cannot drift apart.

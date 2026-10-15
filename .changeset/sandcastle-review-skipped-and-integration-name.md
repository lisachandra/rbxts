---
"@lisachandra/sandcastle": patch
---

Let a member with nothing to review finish, and give each integration a unique worktree name

Two ways a batch could never settle.

- A member whose implementation produced no commits of its own had its review recorded `skipped`, and
  `skipped` was read as terminal nowhere: `isIssueComplete`, `evaluateReview`, the integration source
  resolver, and the hand-off guard all required exactly `done`. Such a member could never be complete,
  so `runSingleIssue` threw "implementation and review must both complete" and every `queue run`
  re-ran it. `runReviewPhase` now records `noCommits: true` with the skip, and the new
  `isReviewComplete` treats `done`, or `skipped` **with that flag**, as terminal. The flag is
  load-bearing: `skipped` is also the fresh-state value for every phase, so accepting it bare would
  let a run that died between implement and review pass as reviewed.
- `git worktree add` registers a worktree under the **basename** of its path, and every integration
  used `<name>/worktree` — so they all registered as `worktree` and git disambiguated them into
  `worktree4`, `worktree5`, and so on. The directory is now named after the integration. A manifest's
  recorded path wins, and a `worktree` directory left by an earlier run still resolves, so an
  in-flight composition is not orphaned by the change.

---
"@lisachandra/sandcastle": patch
---

Make `queue clean`'s selection testable without reading this checkout's state
`selectIssueWorktrees` called `isIssueComplete` and `getLatestReviewMarker`
directly. The first reads `.sandcastle/state/<n>.json` from the checkout the
runner stands in; the second shells out to `gh issue view --json comments`.
Both ran for every registered worktree under `--landed`, so a unit test of the
selection arithmetic could not run hermetically: it inherited whatever state
directory the host happened to have, and on CI — where no state exists but one
spec had left `state/5.json` behind — it reached for `gh` with no token and
failed on a command it was never meant to call.

- `selectIssueWorktrees` takes `isComplete` and `reviewMarker` as reader seams,
  defaulting to the real implementations, mirroring `selectIntegrations`'
  existing `readManifest` seam. `runQueueClean` keeps its behavior.
- The `queue clean` spec supplies both readers, so its verdicts depend only on
  what it passes in. Two new specs cover the `--landed` reason, which had no
  test: an approved, complete issue is selected as `review APPROVED`, and a
  `BLOCKED` review is not a landing.
- `run.test.ts`'s `--once takes no lease` spec now removes the state it
  approves. It was the leak that turned the unrelated `queue clean` spec red:
  its two sibling approval tests already cleaned up and this one did not.

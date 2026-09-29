---
"@lisachandra/sandcastle": minor
---

Rebuild a composition that no longer matches its batch with `queue land --recompose`.

- `queue land` compares the integration manifest against the batch before handing it off, so
  divergence is caught before a resume re-merges the stale sources. Divergence is the batch's tail no
  longer being among the composed sources, a recorded source the batch no longer carries, or a member
  branch whose head moved after it was merged.
- The refusal names the fix instead of `integration-abort`. That advice never worked: an aborted
  manifest was still resumed, so the same tail mismatch came straight back.
- `--recompose` drops the composition (worktree, branch, manifest) and rebuilds it from the batch's
  current tail, in one command. A composition that did not finish — `blocked`, or any status short of
  landed — is rebuilt too, which is what made a failed merge unrecoverable.
- `resetIntegration` is the new lifecycle command behind it: it marks the manifest `aborted` with a
  reason, removes the worktree and the integration branch, then deletes the manifest. Member branches
  are untouched, so resume still skips finished members.
- `integration-status` prints the same comparison as a `Divergence:` block, so a batch that drifted
  says so when you inspect it rather than when you try to land it.

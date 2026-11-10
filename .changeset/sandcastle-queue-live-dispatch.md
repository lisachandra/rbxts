---
"@lisachandra/sandcastle": minor
---

Live queue dispatch: `queue run` re-reads the batch order before each member

The dispatcher held the member list it fired with as a frozen snapshot, so a follow-up a review
registered mid-batch was invisible until the batch re-fired — and the re-fire's reuse path chained
the reused member's pre-insertion branch as the next base, silently bypassing the inserted member
for every member after it.

- `queue run` re-reads the batch's member order before each member and resumes from the last
  processed one, so a follow-up registered after the in-flight member dispatches next, chained
  from that member's branch — inside the same invocation. Reused members still chain inline
  without forcing a re-read (no agent runs during reuse, so the manifest cannot change).
- `queue add --after <m>` from a member worktree now anchors only at the review's own issue; any
  other anchor is refused (omit `--after` to append to the tail). From the primary checkout the
  anchor stays unrestricted, but an insertion ahead of a member that already completed is refused:
  that member is reuse-chained on its pre-insertion branch, and the newcomer would never enter
  the chain. Insertions ahead of dispatched-but-unfinished members are now allowed — live dispatch
  picks them up in the same run.
- Chain containment is drift: `queue check`/`queue list` report a member branch that does not
  contain its predecessor's tip (with the `queue remove` + `queue add --after` fix in the line),
  and `queue run` warns once on the same condition at reuse time. `--strict-chain` or
  `queue.strictChain: true` aborts instead of warning.
- `--max-issues` stops a batch whose tail grew mid-run once its budget is spent, instead of
  running unbudgeted members to the new end.

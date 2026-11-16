---
"@lisachandra/sandcastle": patch
---

Keep one batch in one lane, judge same-host locks by the process table, and let a non-queue command draw lane 0

Three defects found by running the queue for real.

- **A batch that grew mid-run could be re-fired into a second lane.** The scheduler reserved
  _issues_, so a batch whose review registered a follow-up still had an unseen member and read
  READY while its lane was still inside it. A freed slot then started a second child for the same
  batch, against the same worktrees and branch names — both raced the completion markers, the
  pushes, and each other's commits. `selectNextBatch` now takes the set of batches a pool is
  running and refuses to offer any of them to another lane; a serial run passes nothing, so its
  re-fire of a grown batch is unchanged.
- **A same-host lock was stolen on age even when its owner was alive.** A batch lock is held for the
  whole batch and nothing renews it, so a long batch's lock passed the ten-minute window on every
  run. On this host the process table is the authority: a live pid is refused however old the lock
  is, a provably dead pid is reclaimed immediately, and only a lock from another host — which this
  checkout cannot probe — falls back to the age window.
- **`integration-resume` and `merge` refused to start when models were declared only in
  `agents.catalog`.** Those commands have no lane to draw from, so they now fall back to lane 0's
  profile, the same one a serial `queue run` applies. An explicit `--model` still wins.

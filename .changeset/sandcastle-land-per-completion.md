---
"@lisachandra/sandcastle": patch
---

`queue run --parallel --land` now hands a batch off as soon as it finishes, instead of after the pool drains

A parallel run deferred every hand-off until the lane pool returned. Since a freed lane is refilled
immediately, the pool keeps running until the queue is exhausted — so a batch that finished early
waited hours, or the rest of the backlog, before its integration was composed and its pull request
opened. Observed in practice: two batches completed at 4h37m and 5h09m into a run that was still
working through a 41-issue sequence.

- `runParallelPool` gained `PoolHooks.onCompleted`, called once per batch whose lane exited zero, in
  completion order, at the moment its slot frees up (`PoolHooks`, `runParallelPool`).
- `QueuePool` (the test seam) now receives those hooks, so a stub can announce completions the same
  way the real pool does.
- `runQueueParallel` enqueues hand-offs on a promise chain rather than awaiting them in a loop: one
  composition runs at a time, in completion order, while the remaining lanes keep working. The chain
  is awaited after the pool returns, so the run still reports every hand-off result and its exit
  code.
- Completions the hook did not announce — a lane that answered a cancel inside the grace window, or a
  pool implementation reporting only its final list — are queued after the pool, deduplicated against
  the hook's batches so no batch is composed twice.
- The dispatch lease now spans the pool and every hand-off in one `finally`, so a pool that throws
  still releases it. The run lock stays narrower: it covers dispatch, and a composition no longer
  holds it.
- Cancellation still starts no further hand-offs, but a composition already under way is allowed to
  finish rather than being abandoned half-composed.

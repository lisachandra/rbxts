---
"@lisachandra/sandcastle": minor
---

Parallel batch dispatch: `queue run --parallel <n>` with an `agents.catalog` of model + harness profiles

`queue run` was strictly serial: it held the run lock for its whole lifetime precisely so two
dispatchers could never overlap, and the only concurrency in the package was the legacy
`--issue all` worker pool. Parallelism is now available _between_ batches — never inside one, since
each member's branch is the next member's base.

- `agents.catalog` in `sandcastle.config.ts` lists selectable `{ name, backend, model, effort?,
steps? }` profiles. Lane `k` runs `catalog[k % length]`, so assignment is deterministic and
  reproducible; a serial `queue run` uses `catalog[0]`, so both paths start from the same model.
  A catalog is validated at load time: duplicate names and a `backend` outside `agents.enabled` are
  refused with the profile named.
- `queue.parallel` is the repository's allowance (default `1`). `queue run --parallel <n>` may only
  narrow it — asking for more is refused with an error naming the key instead of being clamped —
  and `--parallel` above `1` requires a catalog.
- `--profile <name>` pins one profile for a single batch. It is refused together with
  `--parallel > 1`, where "which lane?" has no answer.
- Each lane is a child `sandcastle queue run --name <batch> --once --profile <name>` process: a
  failed or blocked member exits its process, which would otherwise take sibling lanes down and
  interleave every log into one unreadable stream. Lane output goes to
  `.sandcastle/logs/batch-<batch>.<profile>.log` and the parent prints one line per lane event.
- A failed lane is reported and its siblings keep running; `--max-issues` still refuses an atomic
  batch that would overshoot. Landing stays in the parent and runs serially over the batches that
  finished cleanly, so two compositions never race. A batch whose lane failed is not landed: its
  composition would describe a partial chain.
- `--once` is a lane's entry point. It runs one named batch, skips pruning, gate promotion, and the
  hand-off, and exits `0` on completion — the serial loop's exit `1` means "the queue is exhausted",
  which a lane must not report.
- Exit codes now distinguish the two failure kinds: a failed batch exits `1`, a failed hand-off still
  exits `2`. Under `--json`, each failure carries `kind: "dispatch" | "handOff"`, and a `--dry-run`
  pool emits the lane object it predicts (`kind: "lane"`, `dryRun: true`) instead of writing only
  human text to stderr.
- A lane child refuses to start a pool of its own, so a forwarded `--parallel` can never make a lane
  spawn grandchildren against the same manifest and worktrees.
- A `queue-batch-<name>.lock` is taken by every batch execution, so a hand-run
  `queue run --name <batch>` cannot collide with a lane while the parent holds the run lock.
- A free lane now says why it is free. When the scheduler cannot fill a slot, the pool prints
  `⏸ N lane(s) idle: <reason>` with the scheduler's own explanation, and it distinguishes "the
  remaining batches are already in flight" (full utilization, not reported) from a real obstruction.
  `selectNextBatch` gained an optional `saturated` flag for that distinction; its existing reason
  strings are unchanged.
- A parallel run closes with a summary: total duration, the share of it with every lane busy, and
  each batch's own elapsed time. Under `--json` that is one
  `{ kind: "pool", elapsedMs, saturatedMs, utilization, idleReasons, lanes }` object. A pool that
  fires nothing now reports the exhaustion reason exactly as the serial loop does, instead of exiting
  1 silently.
- `lanes` is a per-slot account: each lane's busy time, idle time, and the batches it ran with their
  profiles. Lanes are now genuine slots — a freed slot is reused, so a third batch across two lanes
  runs in slot 0 or 1 instead of being numbered "lane 3". Batch numbering had made the lane a batch
  counter, which is why a per-lane report needed this fixed first; the human summary prints the
  per-lane lines only when one slot ran more than one batch.
- Batches are never split or moved between lanes to rebalance: members are strictly serial, and a
  lane is a dispatch slot rather than an identity, so the summary reports under-utilization instead of
  silently rewriting the manifest order.

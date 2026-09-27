---
"@lisachandra/sandcastle": minor
---

Let `queue sequence` delete a batch and stop a redefinition from re-ranking the queue.

- `--delete` is reachable from the CLI. `ops.ts` supported it and needed no `--issues`, but the
  argument validator demanded `--issues` for every `queue sequence` call, so the flag could never be
  used — and the drift message that reported a memberless batch told you to run a positional form
  that never parsed. `pnpm sandcastle queue sequence --name <batch> --delete` now drops the batch,
  with `--issues` optional, and `--delete` is rejected outside `queue sequence`.
- A redefinition keeps its position. `defineSequence` appended, so replacing a batch's membership or
  labels silently moved it to the tail of the run order; folding two batches re-ranked the schedule
  and flipped which side of a serialization rule had to wait. Only a new batch joins the tail now.
- `--before <batch>` moves a batch explicitly, so run order can be edited without hand-writing the
  manifest. It rejects an unknown target and a batch that names itself.
- `queue sequence --help` documents both flags, and the memberless-batch drift line prints the
  command that works.

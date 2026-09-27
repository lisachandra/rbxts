---
"@lisachandra/sandcastle": minor
---

Let `queue sequence` delete a batch, keep a redefinition's run order, and move a batch on purpose.

- `--delete` is reachable from the CLI. `ops.ts` supported it and needed no `--issues`, but the
  argument validator demanded `--issues` for every `queue sequence` call, so the flag could never be
  used — and the drift message that reported a memberless batch told you to run a positional form
  that never parsed. `pnpm sandcastle queue sequence --name <batch> --delete` now drops the batch,
  with `--issues` optional, and `--delete` is rejected outside `queue sequence`.
- A redefinition keeps its position. `defineSequence` appended, so replacing a batch's membership or
  labels silently moved it to the tail of the run order; folding two batches re-ranked the schedule
  and flipped which side of a serialization rule had to wait. Only a new batch joins the tail now.
- `--before <batch>` and `--last` move a batch explicitly, so run order can be edited without
  hand-writing the manifest: `--before` places it ahead of another batch, `--last` moves it to the
  end. They are mutually exclusive, `--before` rejects an unknown target and a batch that names
  itself, and `--last` is refused together with `--delete`.
- `queue sequence --help` documents the flags, and the memberless-batch drift line prints the
  command that works.

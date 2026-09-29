---
"@lisachandra/sandcastle": minor
---

Fail `queue run --land` when a hand-off failed, instead of reporting it only on stderr.

- Exit 2 once a requested hand-off failed, after the loop has finished everything it can. Exit 1
  still means nothing could fire — an unknown `--name`, or no READY batch — so a scripted caller can
  tell the two apart. Dry runs and budget stops keep their current codes.
- The failure is printed as a summary with a retry line: which batches failed, why, and
  `pnpm sandcastle queue land --name <batch>`. A failed land no longer exits 1 for the wrong reason,
  which hid "the queue needs a human" behind "there was nothing to run".
- Under `--json`, every hand-off attempt emits `{ handOff: { batch, ok, error } }` alongside the
  per-decision object, and a failed invocation emits a `failures` summary.

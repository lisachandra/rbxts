---
"@lisachandra/sandcastle": minor
---

Reload `sandcastle.config.ts` while a run is in flight

A batch can hold a worktree for hours, so a model that stops being usable — a
promotional window closing, an entitlement lapsing, a provider retiring an id —
meant abandoning the run and losing the conversation each phase had accumulated.
The config file is now the switch: a running run re-reads it every 30 seconds and
continues on what it says.

- A running phase checks `sandcastle.config.ts` on a 30-second tick
  (`SANDCASTLE_RELOAD_CHECK_SECONDS` to change it) and aborts its in-flight
  attempt when the effective selection moved. The retry loop restarts it at once
  on the new selection: a reload is not a failure, so it neither backs off nor
  counts against `SANDCASTLE_PHASE_MAX_RETRIES`. The phase resumes the same
  session, and both resumable backends re-assert the model and effort on it.
- Precedence is "changed wins", per step. The file's own resolution is compared
  before and after, so a step the edit did not touch keeps an explicit
  `--implement-model`, while a step whose config value moved takes the new value
  even over a flag.
- The comparison is semantic, not mtime-based: a comment or formatting save is
  reported as applied and kills nothing. The timestamp is read at nanosecond
  resolution, because a same-millisecond rewrite looked untouched.
- A config that fails to load is reported once per distinct error and ignored;
  the last good configuration keeps running.
- `dir` and any step's `backend` cannot move mid-run and are refused with a
  "start a new run" message, since every path this process created belongs to the
  old directory and a stored session is only resumable by its owning backend.
- A catalog edit applies by profile name, so lanes keep their assignment and
  follow the profile's new model. A deleted or renamed profile keeps its
  last-known values for the rest of the run, with one warning.

Two latent bugs the reload would have made reachable are fixed alongside it:
`--profile` naming an unknown catalog entry silently fell back to lane 0, and
`--profile` was a no-op for a serial `queue run`.

A completed implement phase no longer re-runs when the resolved model differs
from the recorded one. That rule made an unrelated config edit — or a model whose
promotional window closed — redo work that had already passed review. Only
`--force` re-runs a finished phase; `--status` now prints the selection a phase
actually ran on when it differs from the current config.

`loadConfig` no longer caches the evaluated config module (`jiti`'s
`moduleCache: false`), which is what makes a re-read see the file as it now is.

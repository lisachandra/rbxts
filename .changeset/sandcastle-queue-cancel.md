---
"@lisachandra/sandcastle": minor
---

Make `queue run` cancellable with `Ctrl+C`, and add `queue cancel` to clear a dead run's residue

Refs #72.

`Ctrl+C` on `queue run` used to kill Node outright, which skipped every `finally`: the run lock, the
per-batch locks, and the dispatch lease all survived the run. The next invocation then waited ten
minutes for the lock and thirty for the lease, or refused with "Another checkout is dispatching this
queue" — the exact complaint this addresses. Nothing in sandcastle handled `SIGINT` or `SIGTERM`.

- The first `Ctrl+C` now cancels cleanly. The in-flight agent is aborted through the same signal the
  phase budget already uses, no further batch starts, `--parallel` lane children are sent `SIGTERM`
  and given a bounded fifteen seconds to exit, and the run lock, batch locks, and lease are released
  on the way out. A cancelled run exits `130` and lands nothing, so re-running resumes where it
  stopped. A second signal hard-kills immediately for a wedged agent.
- A cancellation is never retried: `runPhaseWithRetry` rethrows it before the fatal-error check and
  its backoff ends as soon as the signal fires, so `Ctrl+C` is not swallowed by a 30s–300s sleep.
- Residue now reclaims itself. Lock and lease payloads already recorded `host` and `pid` but nothing
  ever probed them; a holder on this host whose pid no longer exists is taken over immediately. The
  age window and TTL still govern a holder on another host, whose pid says nothing here. An
  unreadable lock file — a lock caught between `open` and `write` — is no longer stolen instantly:
  it is left alone for five seconds so a live writer is not robbed.
- `queue cancel` clears what a run that is already gone left behind (closed window, crashed editor):
  the dispatch lease and every queue lock. It exits `0` when the checkout is clean and `1` when it
  kept something because its owner is still running, matching `queue check`'s convention that a
  script should be able to tell the two apart. `--force` clears a live owner's residue as a
  documented last resort. It never signals a process — a live run is stopped from its own terminal.

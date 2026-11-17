---
"@lisachandra/sandcastle": patch
---

fix(sandcastle): exit 130 when a cancel reaches the serial dispatch, and release its lock

The cancellation plumbing landed in `sandcastle-queue-cancel.md`; two paths through it still broke
the promise. Both are the same mistake in different places: a `CancelError` was treated as a failure
to propagate instead of a cancellation to report.

`runSequentialIssues` throws `CancelError` out of the member the signal aborted. The serial loop did
not catch it, so it reached `main`'s generic handler, printed a dispatch failure, and exited `1` — a
`Ctrl+C` that looked to a script exactly like a broken batch, which is the one thing a cancellation
is not. The loop now returns the cancelled summary, so the exit code is `130` and the hand-off is
skipped. A real failure still propagates, so its exit stays `1`.

`--parallel` lane children run `queue run --once`, which holds the per-batch lock. A cancelled lane
had the same problem and left that lock behind, because the throw skipped the release. It now exits
`130` from inside the `try`, so the `finally` returns the lock on the way out.

Also asserted, because they were claimed and never tested: the first signal names the escape hatch
(`Ctrl+C again to hard-kill`) on the signal that can still act on it, and a failed dispatch releases
the run lock rather than leaking it.

Reclaiming residue after a hard kill is unchanged: `queue cancel` remains the one-command cleanup,
and a lock or lease whose holder is on this host with a dead pid is still reclaimed immediately.

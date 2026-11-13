---
"@lisachandra/sandcastle": patch
---

Release the queue's locks and lease when a sequential batch fails, instead of exiting past them

Refs #72.

`runSequentialIssues` called `io.exit(1)` from inside the dispatch path when a member was blocked or
failed. `io.exit` is `process.exit`, which does not unwind: `runQueueRun`'s `finally` was skipped, so
an ordinary member failure leaked the run lock, the batch lock, and the dispatch lease exactly as
`Ctrl+C` did. The next run then waited out the ten-minute lock window and the thirty-minute lease
TTL. The failure is now thrown, so the locks and lease are released and `main`'s error handler prints
the same message and exits `1` — the exit code is unchanged.

A cancelled phase is also reported as a cancellation rather than as whatever error interrupted it: the
operator asked for the run to stop, so the invocation must exit `130` and must not send them looking
for a bug that is only the stop.

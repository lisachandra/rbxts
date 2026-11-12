---
"@lisachandra/sandcastle": minor
---

Cross-machine dispatch lease so two checkouts can never work the same queue

The run lock lives in `.sandcastle/`, so it only ever guarded one working tree: two machines running
`queue run` against the same repository could both reserve the same batch, and `SKILL.md` said so
outright ("Cross-machine runs are not guarded"). `queue run` now holds a lease ref on `origin` —
`refs/sandcastle/dispatch-lease`, a root commit whose message is the holder's `{ at, host, pid,
branch }` — for as long as it dispatches, including the serial landing.

- Acquisition is a compare-and-swap: `git push --force-with-lease` against the sha the checkout last
  read, so exactly one machine wins and the loser is refused by name, host, age, and expiry instead
  of dispatching beside a live run.
- The lease expires 30 minutes after its last renewal and a live run renews every 10, so a crashed
  machine cannot wedge the queue. A renewal rejected by the CAS means another checkout now holds the
  lease: the run stops starting new batches at the next batch boundary and lets the batch already in
  flight finish.
- `queue.lease` selects the mode. `auto` (the default) takes the lease and degrades to the previous
  local-lock behavior with a warning when `origin` is unreachable, so one-machine checkouts keep
  working offline; `strict` refuses to dispatch without it; `off` makes no network calls.
  `--no-lease` and `--lease-strict` override the mode for one invocation.
- A `--dry-run` takes no lease, and neither does a `--parallel` lane child — the parent already holds
  it, so a child taking one would deadlock against its own run.
- Lease pushes skip `pre-push` hooks. The ref points at an empty tree that no CI builds, but a hook
  cannot know that: a repository whose `pre-push` runs typecheck/lint/build would pay that cost on
  every acquisition, every 10-minute renewal, and the release — while a `lint:fix`-style hook rewrote
  the working tree an agent was editing.

Clearing a dead machine's lease is one command: `git push origin :refs/sandcastle/dispatch-lease`.

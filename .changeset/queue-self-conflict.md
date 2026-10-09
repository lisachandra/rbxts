---
"@lisachandra/sandcastle": patch
---

Stop a batch's own serialization rule from blocking its re-fire

`queue run` re-read the manifest after every batch but could not act on what it read: `ruleConflicts`
counted a rule whose already-dispatched issues were members of the candidate batch itself, so any
batch holding two members of one `R<n>` rule conflicted with its own membership and could never
re-fire. A review that registered a follow-up into the batch that had just run therefore never got to
run it — the dispatcher silently fell through to the next READY batch. A rule now only conflicts when
it couples the candidate with a _different_ batch.

Two supporting changes:

- `queue run` no longer falls through silently. When the batch it just ran grew members it cannot run,
  it stops and names that batch and the reason instead of starting unrelated work;
  `--continue-anyway` restores the old fall-through.
- A landed member is skipped on a re-fire even when its worktree is gone, restoring the worktree from
  the branch. The branch is the durable artifact and the worktree is disposable, so pruning worktrees
  can no longer turn a re-fire into a full re-run of approved work.

`queue check` now also reports a rule that couples two members of one batch, which position already
serializes, so the rule is not mistaken for protection it does not provide.

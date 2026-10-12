---
"@lisachandra/sandcastle": minor
---

fix(sandcastle): prune a batch's members when GitHub closes them, not when the hand-off succeeds

`queue run` pruned every member whose review was APPROVED as soon as a hand-off completed, so opening
a pull request deleted the batch's record while that pull request was still open. Closing it without
merging then lost the only list of what still had to land, and the still-open members reappeared as
"not placed in the queue" drift.

Pruning is now keyed on the merge. A member leaves the manifest when its issue is CLOSED, checked once
per invocation before anything is selected, so a composed batch keeps its members — and its place in
the queue — until the pull request actually lands. An emptied batch still has its `after` gates
cleared in the same transaction, and `--keep-entries` still suppresses the whole pass.
`mayPruneLanded` is gone with the hand-off gate it expressed.

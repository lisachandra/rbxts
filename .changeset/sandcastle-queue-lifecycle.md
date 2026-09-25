---
"@lisachandra/sandcastle": minor
---

Give the queue the exits it was missing. Sequences can be deleted (`sandcastle queue sequence --name <batch> --delete`), `queue prune` drops sequences its removals emptied, and an empty sequence is now `EMPTY` in `queue list` and drift in `queue check` instead of reading as `READY` forever. Gated issues can be promoted once their conditions resolve: `sandcastle queue promote --issue <n> [--sequence <batch>]` promotes one gate into its title-scope batch, `sandcastle queue promote --apply` promotes every promotable gate, `queue bootstrap` proposes the same promotions under `--apply` (gated entries were previously ignored forever, so a gate could only be cleared by hand), and `queue run --promote-gates` applies them before selection. The manifest commit now verifies the primary checkout is on `queue.commitBranch` (default `baseBranch`) and reports the branch it committed to, leaving unrelated branches alone unless `--queue-commit-any` is passed.

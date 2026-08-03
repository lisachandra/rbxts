---
"@lisachandra/sandcastle": patch
---

Fix resumed runs skipping implement/review after design completes, and attribute phase failures to the phase that actually failed.

On `--resume`, all three phases were evaluated up front before design ran, so implement and review were pre-marked as "skipped" (blocked on a missing plan and missing commits) and never re-evaluated after design finished. The runner now re-checks each phase against on-disk state after its prerequisites complete, and failure attribution uses the phases that were actually attempted instead of the stale pre-flight evaluation.

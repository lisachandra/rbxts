---
"@lisachandra/sandcastle": patch
---

Fix queue registration defects: `sandcastle queue add --after <n>` silently moved the issue to the head of the batch when `<n>` named the issue being moved (it now throws), and a truncated `gh issue list` page was reported as "referenced but not found" drift instead of "not scanned", which made `queue check` fail on large repositories. `queue check` now exits 1 for drift and 2 when `--strict-gates` finds more, and the review prompts carry a `{{QUEUE_RULES}}` placeholder that must be kept when overriding `prompts.review` / `prompts.reviewIntegration`.

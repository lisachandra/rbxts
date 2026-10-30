---
"@lisachandra/sandcastle": patch
---

Give zcode runs a near-infinite in-turn retry budget

The zcode app-server abandons a model request after 10 retries by default
(~11 attempts with a 2s–60s backoff), so a flaky provider endpoint still failed
the whole sandcastle phase once zcode gave up and emitted `turn.failed`.

The wrapper now injects `ZCODE_MODEL_RETRY_MAX_RETRIES=100000` into the
app-server environment when the variable is unset — at zcode's 60s backoff cap
that budget spans years, and zcode still honors `Retry-After` for rate limits.
Preset values pass through untouched (same pattern as the provider-config env
injection), so a caller can dial the budget down per run.

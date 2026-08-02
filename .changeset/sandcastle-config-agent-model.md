---
"@lisachandra/sandcastle": minor
---

Move agent, effort, and model configuration into `sandcastle.config.ts` (`agents.default`,
`agents.models`, `effort`). Legacy `SANDCASTLE_*` environment variables are deprecated and
print warnings; only API keys and CLI credentials remain environment-driven.

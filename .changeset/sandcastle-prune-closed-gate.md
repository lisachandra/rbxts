---
"@lisachandra/sandcastle": patch
---

Fix #504: `queue prune --closed` was unrunnable. The parser gate reserved `--closed` for `queue clean` and rejected every other subcommand, while prune's own contract requires `--closed` — the command could never parse. The gate now exempts exactly that shape; `queue prune --all` and every other flag-batch mismatch stay refused.

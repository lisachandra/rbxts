---
"@lisachandra/sandcastle": patch
---

Normalize `--effort max` to the highest supported backend effort and stop passing unused `READY_LABEL` prompt args.

`max` was accepted by the CLI but rejected by the dirac agent (`--reasoning-effort max` is invalid; the highest supported level is `xhigh`), failing the run at "Agent started". Sandcastle now maps `max` → `xhigh` with a warning instead of failing. Single-issue phases also no longer pass `READY_LABEL` to prompts that never reference it, removing the "provided but not referenced" warning.

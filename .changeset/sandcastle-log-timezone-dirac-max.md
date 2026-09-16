---
"@lisachandra/sandcastle": patch
---

Fix log timestamps and dirac effort handling.

- Log `Run started` markers now pair the UTC timestamp with local wall-clock
  time (`2026-09-06T00:00:00.000Z (local: 2026-09-06 07:00:00 GMT+07:00)`), so
  operators in timezones like GMT+7 see their wall clock. Stored state
  timestamps stay UTC ISO for machine comparison.
- Effort `max` is forwarded untouched to dirac (`--reasoning-effort max` —
  dirac natively supports it via `OPENAI_REASONING_EFFORT_OPTIONS`) instead of
  being downgraded to `xhigh` with a bogus warning. The `max` to `xhigh`
  mapping (and warning) is kept only for backends that genuinely cap at
  `xhigh` (`pi`, `codex`).

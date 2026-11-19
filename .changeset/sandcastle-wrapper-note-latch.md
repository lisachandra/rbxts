---
"@lisachandra/sandcastle": patch
---

Stop a single note latch from swallowing every later wrapper note
The zcode wrapper's `emitNoteOnce` was gated by one process-wide flag, so the
first note to fire muted all the rest for the run. On a host without the ZCode
desktop app, `resolveProviderConfigEnv` fires first and unconditionally — it
could not find a packaged catalog — which consumed the flag before anything
else could speak.

The note that mattered is the resume fix-up's: when a resumed session's model
does not register the requested reasoning level, the wrapper keeps the
session's own level and says so. Under the shared latch that explanation was
dropped exactly when it was needed, so an operator saw a phase quietly ignore
`--reasoning-effort` with no diagnostic. The same flag also muted the account
provider-config notes, which are the only clue when plan-mode models fail to
resolve.

- The latch keys on the message instead of being a single boolean, so the
  "do not repeat this note" guarantee is per-note rather than global. Repeated
  setup notes still collapse; distinct notes all survive.
- The `keeps the session's level when the model does not register it` spec now
  reproduces the Linux CI condition on every host: it removes
  `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`, `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`
  and `LocalAppData` so the setup note is guaranteed to fire first, then
  asserts both notes reach stderr. Removal folds case, because Windows treats
  the env as case-insensitive and deleting one spelling left the other in
  place — the reason this only failed on the Linux leg.

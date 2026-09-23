---
"@lisachandra/core": patch
"@lisachandra/matter": patch
"@lisachandra/platform": patch
"@lisachandra/ui": patch
"@lisachandra/react-router": patch
---

Migrated all `print`/`warn`/`error` callsites to structured logging via `@rbxts/log` (`Log.Info`/`Log.Warn`). Corrected non-halting `Log.Error` usages that were expected to terminate control flow to `Log.Fatal` (the throwing level), and removed unnecessary `pcall` wrapping in the logger sink now that `LogService.Log` with `MessageError` no longer needs defensive error handling.

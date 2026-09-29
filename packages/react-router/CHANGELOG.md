# @lisachandra/react-router

## 1.0.2

### Patch Changes

- [`94effd9`](https://github.com/lisachandra/rbxts/commit/94effd98e6dad8dd7c24db1d8cbad28b9afa9d92) Thanks [@lisachandra](https://github.com/lisachandra)! - Migrated all `print`/`warn`/`error` callsites to structured logging via `@rbxts/log` (`Log.Info`/`Log.Warn`). Corrected non-halting `Log.Error` usages that were expected to terminate control flow to `Log.Fatal` (the throwing level), and removed unnecessary `pcall` wrapping in the logger sink now that `LogService.Log` with `MessageError` no longer needs defensive error handling.

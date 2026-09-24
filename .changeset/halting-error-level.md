---
"@lisachandra/core": patch
---

Restored non-halting `Log.Error` semantics in `LogEventSFTOutputSink`: only the `Error` level's
`LogService.Log` dispatch is `pcall`'d (`MessageError` throws in-engine), so `Error` stays a
non-halting record while `Log.Fatal` remains the halting level and the patched `Fatal(): never`
contract stays honest.

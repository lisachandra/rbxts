# Upstream patches

Hand-maintained pnpm patches, referenced through `patchedDependencies` in `pnpm-workspace.yaml`.
pnpm applies them with `git apply`, so the rationale lives here rather than inside the `.patch` file.

## Conventions

- Patches are **unversioned** (`patches/<name>.patch`), so pnpm applies them to whatever version the
  catalog resolves. A stale patch fails `pnpm install` loudly; check the failing hunk against the new
  upstream before widening context or re-pinning.
- Every patch gets an entry below: what it changes, why it is not upstreamed yet, and the invariant
  the repo depends on. Removing a patch means first proving nothing relies on it.

## `@rbxts__log.patch`

Upstream: `@rbxts/log` (catalog `0.6.3`).

1. `Logger.Fatal` and `Log.Fatal` are typed `never` instead of `string`, so `rbxtsc` treats the call
   as terminating and call sites can drop unreachable `return`/`break` statements.
2. Adds `exports` for `.` and `./Core` (`out/init.lua`, `out/Core/init.lua`), needed for the
   `@rbxts/log/Core` imports in `packages/core/src/logger.ts`.
3. `Logger:Fatal` (compiled `out/Logger.lua`) fails closed when no sink is installed: `#self.sinks == 0`
   raises `error(rendered)` instead of returning, so the `never` return type holds even before
   `setupLogger()` runs (test harnesses, bootstrap, REPL). Without it, an unwired logger made every
   `Log.Fatal` guard a silent no-op.

**Invariant:** `Log.Fatal` returns only when a _non-halting_ sink handled the event.
`LogEventSFTOutputSink` (`packages/core/src/logger.ts`) halts: `LogService.Log` with `MessageError` throws
in-engine, the non-Roblox fallback calls `error()`, and the `out/Logger.lua` hunk above covers a logger
that was never wired. Levels below `Fatal` stay non-halting by design (`Error` is `pcall`ed so it records
instead of halting).

**Re-validate when:** bumping the catalog version, changing the sink (levels, `pcall` scope, fallback
writes), installing a custom logger whose `Fatal` sink returns instead of throwing, or dropping the
empty-sink guard above — in any of those cases `Log.Fatal` can return and code after it runs, so this
patch is lying.

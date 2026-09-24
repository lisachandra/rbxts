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

**Invariant:** the `never` return is a type-level claim, not runtime behaviour — `@rbxts/log`
dispatches to sinks and keeps going. It is only sound because every consumer installs
`LogEventSFTOutputSink` (`packages/core/src/logger.ts`), which halts at `Fatal`: `LogService.Log` with
`MessageError` throws in-engine, and the non-Roblox fallback calls `error()`.

**Re-validate when:** bumping the catalog version, changing the sink (levels, `pcall` scope, fallback
writes), or installing a custom logger whose `Fatal` sink returns instead of throwing — in that case
code after `Log.Fatal` runs and this patch is lying.

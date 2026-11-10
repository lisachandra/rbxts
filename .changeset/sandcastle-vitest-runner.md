---
"@lisachandra/sandcastle": minor
---

Run the suite with vitest instead of node:test

The suite outgrew the hand-maintained file list in the test scripts — a new test file had to be
appended to two scripts or it silently never ran — and node:test kept the reporting and slow-test
ergonomics awkward (`--experimental-test-coverage`, per-file argv plumbing).

- `pnpm test` in the package still typechecks first (`tsc -p tsconfig.test.json`, unchanged) and
  then runs the suite with vitest, discovered by glob (`src/**/*.test.ts`): a new test file runs
  without touching any script.
- Test files import `describe`/`test`/`afterEach` from `vitest` instead of `node:test`;
  semantics are unchanged, including the per-file io/env reset through `registerTestHooks`.
- `vitest.config.ts` pins `testTimeout` to 120s — the suite has intentional real-time tests that
  trip vitest's 5s default — and scopes discovery to `src`, so compiled copies under `dist/`
  never run.
- `test:coverage` uses `@vitest/coverage-v8` instead of `--experimental-test-coverage`.

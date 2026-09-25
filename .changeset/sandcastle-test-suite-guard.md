---
"@lisachandra/sandcastle": patch
---

Run every test in the package. `pnpm test` enumerates its files, so `src/help.test.ts`, `src/queue/persist.test.ts`, and `src/steps.test.ts` had never executed; all three now run and `src/test-suite.test.ts` fails the suite whenever a `src/**/*.test.ts` file is missing from the `test` or `test:coverage` script.

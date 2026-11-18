# Agent Coverage Policy

Use when a change touches test coverage, the coverage gate, or a `coverageSummary` figure, and when
deciding whether new code needs a spec before it lands.

## Destination

**90% lines, gated.** Branches, functions and statements are reported but ungated. The repository
floor and the per-lane floors only ratchet up.

The floors are not the destination and are not a target. They are the promise that the measured
number will not go down. Today they sit at the measured level because nothing higher exists yet:

| Floor        | Value | Lane                        |
| ------------ | ----- | --------------------------- |
| `demo`       | 7.85% | `test/demo`                 |
| `repository` | 7.85% | every measured lane, folded |

## How To Read The Number

```bash
pnpm test          # the suites write the summaries
pnpm coverage      # folds them, prints the report, enforces the floors
```

`pnpm coverage --json` prints one machine-readable object for CI; `pnpm coverage` prints the report a
human reads. It exits 1 only when a floor is missed.

The reporters are named in `jest.shared.ts`, not passed as flags, so a local run and a CI run write
exactly the same files: `json`, `json-summary`, `lcov`, `text`. `json-summary` is the one `pnpm
coverage` reads. Run the suites before the gate — the gate reads a report, and it will happily quote
one from an earlier run if nothing wrote a new one.

CI runs it as `Check the coverage floors` after the suites, and `Extract coverage` feeds the badge
from the same object. There is no second implementation of the fold in the workflow.

## Measured Versus Unmeasured

A lane is **measured** when it wrote `test/<lane>/coverage/coverage-summary.json`. The report is the
only evidence: `collectCoverage: true` in a config, a `default.project.json`, and a non-empty spec
directory all appeared in six lanes that emit no summary at all.

An **unmeasured** lane is reported by name with its reason and contributes nothing to the fold. It is
never counted as `0%` — that would both understate the repository and hide the harness defect behind
a number that looks like a test gap.

The six unmeasured package lanes and `demo`, at the time of writing:

| Lane             | Status                                                           |
| ---------------- | ---------------------------------------------------------------- |
| `demo`           | measured, 30/382 lines                                           |
| `core`           | unmeasured: output mounted outside the lane's instrumented frame |
| `matter`         | unmeasured: same                                                 |
| `platform`       | unmeasured: same                                                 |
| `react-router`   | unmeasured: same                                                 |
| `react-template` | unmeasured: same                                                 |
| `ui`             | unmeasured: declares a project with no specs                     |

The single cause behind the five: each mounts its package's compiled output through a `$path` that
leaves the lane's own instrumented frame, and Istanbul probes are placed only for coverage roots
inside the frame. Workspace mode is not the escape hatch — the emulator backend refuses it outright
(`--workspace is not supported by the emulator backend`). See #15, #16, #18, #20.

The consequence that matters for planning: **the current figure measures `test/demo` only.** It is
not a statement about the packages. Work that "raises coverage" has to first make a package lane
report, and that is a harness change, not a spec.

## The Ratchet

Floors move up when the measurement does, never down.

- A floor below the measurement is a regression budget nobody asked for.
- A floor above it fails immediately, so it cannot be the first rung.
- When a change raises a measured lane, raise that lane's floor in the same commit. The spec
  `the committed policy` in `scripts/coveragePaths.test.mjs` pins the values and has to be updated
  with them.
- Lowering a floor requires an argument in the commit message. Changing the constant is not one.

Adding an untested file lowers the percentage and fails the floor. That is intended pressure, and
the answer is a test, not a widened ignore list.

## What Is In The Universe

Every `.ts`/`.tsx` under `packages/*/src` is in scope. Coverage uses vitest `all` / Istanbul
semantics, so every instrumented file matching the include globs is reported — a source file with no
test shows `0%` rather than being silently omitted.

`coveragePathIgnorePatterns` does not grow. A file is excepted only if no test could ever execute
it, and that class is vendored `.luau` (`r6ik`, `formatTable`, `setup`, `utils`, `include/*`), which
is excluded by file extension and needs no config entry.

`packages/sandcastle` is in the policy as a future lane, on its own runner: it uses vitest, which
rejects the Jest coverage reporter flags, so it is excluded from the recursive test run and reports
nothing today.

## Where The Numbers Live

`scripts/coveragePaths.mjs` holds the floors, the per-lane reasons, and the arithmetic. This document
deliberately does not restate the arithmetic: a number stated in prose and a number enforced in code
drift apart the moment either moves. The module answers every question the entry point asks, and its
spec (`scripts/coveragePaths.test.mjs`) pins the fold, the rounding, the absence rule, and the floor
table against the tree.

Two suites sit outside the lanes and therefore outside the fold: `pnpm test:scripts` runs
`scripts/*.test.mjs` under `node --test` (the recursive package run never reaches them), and
`packages/sandcastle` runs vitest. Neither writes a `coverage-summary.json`, so neither appears in
the report; adding either is a change to this policy, not a config tweak.

## Verification

```bash
pnpm coverage                                     # the report and the floors
node --test scripts/coveragePaths.test.mjs        # the policy's arithmetic
pnpm test:scripts                                 # every repository script spec
```

A floor failure names the lane, the actual figure and the floor. Read it as "the measurement moved
below a promise", then decide whether a test is missing or the harness stopped reporting — the two
look the same in the exit code and are very different problems.

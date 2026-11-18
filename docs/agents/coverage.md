# Agent Coverage Policy

Use when a change touches test coverage, the coverage gate, or a `coverageSummary` figure, and when
deciding whether new code needs a spec before it lands.

## Destination

**90% lines, gated.** Branches, functions and statements are reported but ungated. The repository
floor and the per-lane floors only ratchet up.

The floors are not the destination and are not a target. They are the promise that the measured
number will not go down. Every lane measured for the first time on 2026-11-19 — the first run whose
harness probed the mounted packages too — and each floor sits at that measurement:

| Floor            | Value  | Lane                        |
| ---------------- | ------ | --------------------------- |
| `core`           | 26.86% | `test/core`                 |
| `demo`           | 8.65%  | `test/demo`                 |
| `matter`         | 25.05% | `test/matter`               |
| `platform`       | 14.37% | `test/platform`             |
| `react-router`   | 12.88% | `test/react-router`         |
| `react-template` | 11.05% | `test/react-template`       |
| `repository`     | 16.34% | every measured lane, folded |
| `ui`             | 19.12% | `test/ui`                   |

The numbers in the table are the gate's own rounding (`percentOf`), not Istanbul's: Istanbul floors
its two decimals and can sit a hundredth below what `pnpm coverage` prints, and a floor set from
Istanbul's figure would read one hundredth below the measurement it was cut from.

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
directory all appeared in six lanes that once emitted no summary at all.

An **unmeasured** lane is reported by name with its reason and contributes nothing to the fold. It is
never counted as `0%` — that would both understate the repository and hide the harness defect behind
a number that looks like a test gap. The reasons table (`UNMEASURED_REASONS` in
`scripts/coveragePaths.mjs`) is exceptions-only and empty today: every lane measures, so a lane with
no summary has no known cause and fails its floor instead.

The seven lanes, as measured on 2026-11-19:

| Lane             | Lines     |
| ---------------- | --------- |
| `core`           | 405/1508  |
| `demo`           | 607/7019  |
| `matter`         | 1378/5502 |
| `platform`       | 858/5972  |
| `react-router`   | 206/1599  |
| `react-template` | 177/1602  |
| `ui`             | 1109/5800 |

The history behind that table is a harness story, and it is worth keeping because the same shape can
come back with a new mount: each package lane mounted its package's compiled output through a
`$path` that left the lane's own instrumented frame, and Istanbul probes were placed only for
coverage roots inside the frame — so `demo` (which mounts its own source) measured and the other six
did not. Two fixes landed together. `jest.shared.ts` now names `collectCoverageFrom` explicitly,
because a universe derived from the lane's `include` patterns names only the lane's own `src`; and
the harness release pinned in the catalog (`@isentinel/jest-roblox` v0.4.13-fork.2) fixed the
junction-blind walks that follow — a pnpm workspace's `node_modules/@scope` folders are junctions,
every one of which a `Dirent` reports as "not a directory", and four separate walkers trusted that
bit. See the fork's history for the four: root detection, the spine mirror, and the two staging
demotes.

The consequence that matters for planning now: **the figure measures both halves every lane runs** —
the lane's own specs and the mounted packages they exercise. A package with no spec still reports
its files at `0%` inside every lane that mounts it, so the repository fold is a statement about the
packages. Work that "raises coverage" is ordinary spec work again, not a harness change.

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

The universe is named, not derived: `jest.shared.ts` sets `collectCoverageFrom`, because left unset
the harness derives it from each lane project's `include` patterns — which name only the lane's own
`src`, and every mounted package would be mirrored unprobed. Three glob groups:

- the lane's own TypeScript (`src/**/*.ts(x)`);
- the mounted packages' TypeScript (`node_modules/@lisachandra/*/src/**/*.ts(x)`), matched through
  the `.map` sidecar the compiler ships, so a probe lands on the source file it belongs to;
- the mounted packages' compiled output (`node_modules/@lisachandra/*/out/**/*.luau`) —
  `constant`, `constant-protocol` and `types` ship no `.map` sidecar, so their candidates are the
  compiled paths themselves, and their rows in a report are keyed on `.luau` paths.

Vendor mounts (`@rbxts`, `@rbxts-js`) match no group and stay unprobed. That is deliberate: they are
other people's shipped code, and a monorepo cannot ratchet a floor against lines it does not own.

Coverage uses vitest `all` / Istanbul semantics, so every file matching the globs is reported — a
source file with no test shows `0%` rather than being silently omitted. One class of that is worth
naming: a spec listed in the emulator's parity ledger (`docs/agents/offline-runtime-spike.md`) does
not run, so its subject measures `0%` until the parity gap closes. That is the honest number for a
spec the lane cannot execute, not a hole in the universe.

`coveragePathIgnorePatterns` does not grow. A file is excepted only if no test could ever execute
it, and that class is vendored `.luau` (`r6ik`, `formatTable`, `setup`, `utils`, `include/*`), which
is excluded by file extension and needs no config entry.

`packages/sandcastle` is in the policy as a future lane, on its own runner: it uses vitest, which
rejects the Jest coverage reporter flags, so it is excluded from the recursive test run and reports
nothing today.

## Where The Numbers Live

`scripts/coveragePaths.mjs` holds the floors, the exceptions table for unmeasured lanes, and the
arithmetic. This document
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

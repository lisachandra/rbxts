# Conditional `prepare` build skipping for local `rbxts` development

## Summary

This design keeps package-level `prepare` support for GitHub consumers while avoiding unnecessary builds during local `pnpm install` inside the `rbxts` development repository.

The approach is to move the detection logic into one shared Node helper script and have each package `prepare` script call that helper before falling through to `pnpm run build`.

When the helper detects that the current package is being installed inside the local `lisachandra/rbxts` repository clone, it exits successfully so `prepare` does not build. In all other cases, it exits with a non-zero code so the existing `build` command still runs.

## Problem

Each publishable package currently defines a `prepare` script similar to [`"prepare": "node -e \"if (process.cwd().includes('node_modules')) process.exit(0); else process.exit(1)\" || pnpm run build"`](packages/core/package.json:114).

This causes [`pnpm install`](package.json:7) in the workspace to trigger package builds during normal local development. That behavior is slow and redundant for the `rbxts` monorepo, but `prepare` still needs to exist because consumers install these packages directly from GitHub and need source builds in that context.

## Goals

- Keep package-level `prepare` support for GitHub consumers.
- Skip redundant builds during local development installs in the canonical `lisachandra/rbxts` repository.
- Centralize the decision logic so all packages behave consistently.
- Default to building whenever detection is uncertain.

## Non-goals

- Removing `prepare` from packages.
- Changing publish-time build behavior.
- Supporting arbitrary local forks as build-skip environments.
- Replacing package build commands such as [`"build": "shx rm -rf out && rbxtsc --verbose --allowCommentDirectives"`](packages/core/package.json:115).

## Chosen approach

### Shared helper script

Add one shared helper at a root-level path such as `scripts/should-skip-prepare-build.mjs`.

Each package `prepare` script will call the helper and only run `pnpm run build` when the helper indicates that the build should not be skipped.

Conceptually, package scripts become:

`node ../../scripts/should-skip-prepare-build.mjs || pnpm run build`

The helper becomes the single source of truth for all `prepare` decisions.

### Detection rule

The helper should:

1. Start from the current package directory.
2. Walk upward until it finds a Git repository root containing `.git/config`.
3. Read `.git/config`.
4. Inspect the `origin` remote URL.
5. If the `origin` URL points to `lisachandra/rbxts`, exit with code `0` to skip the build.
6. Otherwise, exit with code `1` so the shell falls through to `pnpm run build`.

Accepted matches should include both common GitHub URL forms:

- `https://github.com/lisachandra/rbxts.git`
- `git@github.com:lisachandra/rbxts.git`

A substring-style match on `lisachandra/rbxts` is acceptable as long as it is only applied to the parsed `origin` remote URL value.

## Why this approach

This approach is preferred over a long inline [`node -e`](packages/core/package.json:114) expression because it avoids duplicated logic across six packages and is easier to update safely.

It is also preferred over invoking `git config --get remote.origin.url` because reading `.git/config` directly is less dependent on command availability and is easier to control within a cross-platform Node script.

## Failure behavior

The helper should be conservative.

If any of the following conditions occur, it should **not** skip the build:

- `.git` cannot be found while walking upward
- `.git/config` does not exist
- `origin` is missing
- the file cannot be read
- the config format is not recognized
- the URL does not match `lisachandra/rbxts`

In all of those cases, the helper exits with code `1` so `pnpm run build` still executes.

This preserves GitHub consumer behavior and avoids accidental under-building.

## Script contract

The helper is intentionally simple:

- Exit `0`: skip build
- Exit non-zero: run build

That lets package scripts continue using the existing shell pattern with `||` and avoids introducing extra output parsing or environment variable plumbing.

## Package changes

The following packages currently define `prepare` and should be updated to use the shared helper:

- [`packages/types/package.json`](packages/types/package.json)
- [`packages/test/package.json`](packages/test/package.json)
- [`packages/core/package.json`](packages/core/package.json)
- [`packages/ui/package.json`](packages/ui/package.json)
- [`packages/matter/package.json`](packages/matter/package.json)
- [`packages/platform/package.json`](packages/platform/package.json)

No other behavior changes are required in those manifests.

## Data flow

1. [`pnpm install`](package.json:7) triggers package `prepare`.
2. Package `prepare` runs the shared helper.
3. The helper resolves whether the current install is happening inside the canonical `rbxts` repository.
4. If yes, `prepare` exits successfully and the package build is skipped.
5. If no, shell control falls through to [`pnpm run build`](packages/core/package.json:115).

## Testing strategy

Testing should focus on behavior rather than implementation details.

### Manual verification cases

1. **Local canonical repo clone**
    - `origin` points to `lisachandra/rbxts`
    - expected result: `prepare` skips build

2. **Different repository or consumer checkout**
    - `origin` does not point to `lisachandra/rbxts`
    - expected result: `prepare` runs build

3. **No Git metadata available**
    - no `.git/config` found
    - expected result: `prepare` runs build

4. **Malformed or unreadable Git config**
    - expected result: `prepare` runs build

### Optional automated tests

If this repo already has a lightweight place for Node-side utility tests, the helper can be unit tested by isolating path walking and config parsing into pure functions. That is optional; manual verification is sufficient for the initial rollout.

## Risks

- If a consumer clones this exact repository and installs dependencies locally, the helper will skip builds there too. That is acceptable because the behavior is explicitly tied to the canonical `rbxts` repository.
- If the repository remote naming convention changes away from `origin`, the helper will stop skipping local builds and will safely revert to building.
- If the repository is cloned from a fork, builds will run. That is acceptable because fork support is out of scope.

## Alternatives considered

### Inline `node -e` script in each package

Rejected because it duplicates logic and makes maintenance harder.

### `git config --get remote.origin.url`

Rejected because it relies more directly on shell tooling and offers less control than a shared Node helper.

### Environment variable opt-out

Rejected because the desired behavior is automatic for this repository based on Git remote identity.

## Implementation outline

1. Add `scripts/should-skip-prepare-build.mjs`.
2. Implement upward repository detection and `.git/config` parsing.
3. Match `origin` against `lisachandra/rbxts`.
4. Replace each package `prepare` script to call the shared helper.
5. Verify local workspace install no longer rebuilds packages unnecessarily.
6. Verify a non-matching repository path still triggers builds.

## Assumptions

- The canonical local development repository has an `origin` remote pointing to `lisachandra/rbxts`.
- Package consumers installing from GitHub need `prepare` to continue building from source.
- Building on uncertainty is safer than skipping.

## Open decisions resolved

- Only `origin` is authoritative.
- Missing `.git` should default to build.
- SSH and HTTPS remote URL forms should both count as canonical matches.

## Confidence

Confidence before saving spec: 8/10

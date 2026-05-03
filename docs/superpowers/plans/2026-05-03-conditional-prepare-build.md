# Conditional Prepare Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep package-level `prepare` support for GitHub consumers while skipping redundant `prepare` builds during local installs inside the canonical `lisachandra/rbxts` repository.

**Architecture:** Add one shared Node helper under [`scripts/`](scripts/) that walks upward to find [`.git/config`](.git/config), parses the `origin` remote URL, and exits `0` only when that remote points to `lisachandra/rbxts`. Update each package [`prepare`](packages/core/package.json:114) script to call that helper and fall through to the existing [`build`](packages/core/package.json:115) command when the helper does not authorize skipping.

**Tech Stack:** Node.js, pnpm workspaces, JSON package manifests, Git config parsing

---

## File Structure

- Create: [`scripts/should-skip-prepare-build.mjs`](scripts/should-skip-prepare-build.mjs)
  Responsibility: locate the repo Git config, extract the `origin` URL, decide whether the current install is happening inside the canonical `lisachandra/rbxts` repo, and communicate the decision only through process exit code.
- Modify: [`packages/types/package.json`](packages/types/package.json)
  Responsibility: replace inline `node -e` `prepare` detection with the shared helper.
- Modify: [`packages/test/package.json`](packages/test/package.json)
  Responsibility: replace inline `node -e` `prepare` detection with the shared helper.
- Modify: [`packages/core/package.json`](packages/core/package.json)
  Responsibility: replace inline `node -e` `prepare` detection with the shared helper.
- Modify: [`packages/ui/package.json`](packages/ui/package.json)
  Responsibility: replace inline `node -e` `prepare` detection with the shared helper.
- Modify: [`packages/matter/package.json`](packages/matter/package.json)
  Responsibility: replace inline `node -e` `prepare` detection with the shared helper.
- Modify: [`packages/platform/package.json`](packages/platform/package.json)
  Responsibility: replace inline `node -e` `prepare` detection with the shared helper.

## Implementation notes

- The helper must be conservative: if anything is missing or unreadable, it should exit non-zero so [`pnpm run build`](packages/core/package.json:115) still runs.
- Match only the parsed `origin` URL value, not arbitrary file contents.
- Treat both HTTPS and SSH GitHub remote forms as canonical matches by checking for the normalized substring `lisachandra/rbxts` after lower-risk parsing.
- Do not add environment-variable overrides in this implementation; the approved spec keeps behavior automatic and `origin`-based.

### Task 1: Add the shared prepare-skip helper

**Files:**
- Create: [`scripts/should-skip-prepare-build.mjs`](scripts/should-skip-prepare-build.mjs)

- [ ] **Step 1: Write the helper that finds `.git/config`, parses `origin`, and exits by decision**

```js
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CANONICAL_REPO_FRAGMENT = "lisachandra/rbxts";

function findGitConfig(startDir) {
	let currentDir = startDir;

	while (true) {
		const gitConfigPath = path.join(currentDir, ".git", "config");
		if (existsSync(gitConfigPath)) {
			return gitConfigPath;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return undefined;
		}

		currentDir = parentDir;
	}
}

function getOriginRemoteUrl(configContents) {
	const remoteSectionMatch = configContents.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/);
	if (!remoteSectionMatch) {
		return undefined;
	}

	const urlMatch = remoteSectionMatch[1].match(/^\s*url\s*=\s*(.+)\s*$/m);
	return urlMatch ? urlMatch[1].trim() : undefined;
}

function shouldSkipPrepareBuild() {
	const gitConfigPath = findGitConfig(process.cwd());
	if (!gitConfigPath) {
		return false;
	}

	let configContents;
	try {
		configContents = readFileSync(gitConfigPath, "utf8");
	} catch {
		return false;
	}

	const originUrl = getOriginRemoteUrl(configContents);
	if (!originUrl) {
		return false;
	}

	return originUrl.includes(CANONICAL_REPO_FRAGMENT);
}

process.exit(shouldSkipPrepareBuild() ? 0 : 1);
```

- [ ] **Step 2: Inspect the helper file for spec coverage before wiring it in**

Checklist:
- walks upward from `process.cwd()`
- looks specifically for [`.git/config`](.git/config)
- reads only the `origin` remote section
- exits `0` only for `lisachandra/rbxts`
- exits `1` for missing file, missing remote, parse failure, or non-matching URL

Expected: all five checks are visibly satisfied in [`scripts/should-skip-prepare-build.mjs`](scripts/should-skip-prepare-build.mjs).

### Task 2: Update all package `prepare` scripts to use the helper

**Files:**
- Modify: [`packages/types/package.json`](packages/types/package.json)
- Modify: [`packages/test/package.json`](packages/test/package.json)
- Modify: [`packages/core/package.json`](packages/core/package.json)
- Modify: [`packages/ui/package.json`](packages/ui/package.json)
- Modify: [`packages/matter/package.json`](packages/matter/package.json)
- Modify: [`packages/platform/package.json`](packages/platform/package.json)

- [ ] **Step 1: Replace each inline `prepare` command with the shared helper invocation**

Use this exact script value in every package manifest:

```json
{
	"scripts": {
		"prepare": "node ../../scripts/should-skip-prepare-build.mjs || pnpm run build"
	}
}
```

Apply it to these six files:

- [`packages/types/package.json`](packages/types/package.json)
- [`packages/test/package.json`](packages/test/package.json)
- [`packages/core/package.json`](packages/core/package.json)
- [`packages/ui/package.json`](packages/ui/package.json)
- [`packages/matter/package.json`](packages/matter/package.json)
- [`packages/platform/package.json`](packages/platform/package.json)

- [ ] **Step 2: Verify no package still uses the old inline `node -e` pattern**

Run: `findstr /s /n /c:"node -e \"if (process.cwd().includes('node_modules'))" packages\package.json`

Expected: no matches returned.

### Task 3: Verify skip/build behavior from the workspace

**Files:**
- Test: [`scripts/should-skip-prepare-build.mjs`](scripts/should-skip-prepare-build.mjs)
- Test: [`packages/core/package.json`](packages/core/package.json)

- [ ] **Step 1: Run the helper directly from one package directory inside this repo**

Run: `cd packages\core && node ..\..\scripts\should-skip-prepare-build.mjs`

Expected: command exits successfully with no output because the local `origin` remote points to `lisachandra/rbxts`.

- [ ] **Step 2: Check the success exit code from the direct helper run**

Run: `cd packages\core && node ..\..\scripts\should-skip-prepare-build.mjs && echo EXIT:%ERRORLEVEL%`

Expected: `EXIT:0`

- [ ] **Step 3: Run one package `prepare` script from the canonical repo**

Run: `pnpm --filter @lisachandra/core prepare`

Expected: the command completes without starting [`rbxtsc`](packages/core/package.json:115), proving the helper skipped the build in the canonical repo.

### Task 4: Verify conservative fallback behavior

**Files:**
- Test: [`scripts/should-skip-prepare-build.mjs`](scripts/should-skip-prepare-build.mjs)

- [ ] **Step 1: Run the helper from outside the repository tree to force fallback**

Run: `cd C:\ && node d:\Github\Roblox\Packages\rbxts\scripts\should-skip-prepare-build.mjs && echo EXIT:%ERRORLEVEL%`

Expected: no `EXIT:0` line appears because the helper exits non-zero when it cannot find [`.git/config`](.git/config).

- [ ] **Step 2: Run the helper again with an explicit fallback echo to confirm non-zero exit**

Run: `cd C:\ && node d:\Github\Roblox\Packages\rbxts\scripts\should-skip-prepare-build.mjs || echo EXIT:%ERRORLEVEL%`

Expected: `EXIT:1`

- [ ] **Step 3: Review the helper logic against all approved failure cases**

Checklist:
- missing [`.git/config`](.git/config) returns `false`
- unreadable config returns `false`
- missing `origin` returns `false`
- unparsable `url =` line returns `false`
- non-matching remote returns `false`

Expected: every failure case from the approved spec is explicitly handled in [`scripts/should-skip-prepare-build.mjs`](scripts/should-skip-prepare-build.mjs).

### Task 5: Final diff review and commit

**Files:**
- Create: [`scripts/should-skip-prepare-build.mjs`](scripts/should-skip-prepare-build.mjs)
- Modify: [`packages/types/package.json`](packages/types/package.json)
- Modify: [`packages/test/package.json`](packages/test/package.json)
- Modify: [`packages/core/package.json`](packages/core/package.json)
- Modify: [`packages/ui/package.json`](packages/ui/package.json)
- Modify: [`packages/matter/package.json`](packages/matter/package.json)
- Modify: [`packages/platform/package.json`](packages/platform/package.json)

- [ ] **Step 1: Inspect the final diff for only the intended files**

Run: `git diff -- scripts/should-skip-prepare-build.mjs packages/types/package.json packages/test/package.json packages/core/package.json packages/ui/package.json packages/matter/package.json packages/platform/package.json`

Expected: one new helper file and six `prepare` script replacements.

- [ ] **Step 2: Commit the implementation**

Run: `git add scripts/should-skip-prepare-build.mjs packages/types/package.json packages/test/package.json packages/core/package.json packages/ui/package.json packages/matter/package.json packages/platform/package.json && git commit -m "build: skip prepare in canonical repo"`

Expected: one commit containing the helper and package manifest updates.

## Self-review

- Spec coverage check: the plan adds the shared helper, updates all six package manifests, verifies canonical-repo skip behavior, and verifies conservative fallback behavior.
- Placeholder scan: no `TBD`, `TODO`, or unresolved references remain.
- Type and naming consistency: helper filename, command strings, and package file paths are consistent across all tasks.

## Assumptions

- The local canonical clone uses an `origin` remote whose URL contains `lisachandra/rbxts`.
- `node` is available in the environment that runs package lifecycle scripts.
- Package directories remain exactly two levels below the repo root, so [`../../scripts/should-skip-prepare-build.mjs`](scripts/should-skip-prepare-build.mjs) is the correct relative path from each package manifest.

## Confidence

Confidence before saving plan: 8/10

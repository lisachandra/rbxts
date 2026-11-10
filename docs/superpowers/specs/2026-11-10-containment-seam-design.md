# Security controls: the containment seam for runner-owned paths

## Summary

This design gives `@lisachandra/sandcastle` one module that answers a single question — _is this path
inside a directory the runner owns?_ — and makes every destructive and write path pass through it. It
also closes the two sinks that answer the question today by not asking it: the recursive delete in
`removeWorktree` and the `cmd.exe` delete on Windows.

It is slice **D** of the 2026-11-10 combined security and architecture run. Slices A (admin guard,
shipped as #46), B (item-mutation policy), and C (child-process seam) are separate; this slice touches
only `packages/sandcastle`, and within it only the path-handling modules and the integration manifest.

## Problem Statement

The runner creates, merges, and **recursively deletes** directories. It has no module that owns "which
directories may I delete". Four call sites each re-derive the answer, and two of them do not derive it
at all.

The concrete chain, all verified:

1. `readIntegrationManifest` reads `.sandcastle/integrations/<name>/manifest.json` with a bare
   `JSON.parse(...) as IntegrationManifest`. The queue manifest beside it _is_ zod-validated; this one
   is not.
2. `integrationBasePath` prefers the recorded `worktree` string and resolves it against `stateRoot`.
   An absolute value replaces the root entirely — `path.resolve(stateRoot, "C:/Windows")` is
   `C:\Windows`.
3. `removeWorktree` deletes whatever path it is handed. It does not check that the path is under
   `worktreesDir` or `integrationsDir`, and does not check that it is a registered worktree.
4. On Windows the delete is `io.execFileSync("cmd", ["/c", "rmdir", "/s", "/q", worktreePath])`.
   `execFileSync` is not a shell, but `cmd.exe` re-parses everything after `/c`: a path containing `&`
   splits the command and the remainder executes.

So one unvalidated JSON string reaches a recursive delete and a command interpreter. The reachable
entry points are `integration-cleanup --name <n>`, `queue clean --integrations`,
`queue clean --reset`, and `queue land --recompose`.

The writer of that manifest does not need to be the operator. `sharedStateRoot` redirects a linked
worktree's state paths to the primary checkout, so an agent running inside a sandcastle worktree writes
the same `.sandcastle/integrations/` tree the operator later cleans. The threat model already classes
agent output as prompt-injectable.

The same unvalidated `manifest.name` reaches three more sinks: `writeIntegrationManifest` writes
`<integrationsDir>/<name>/manifest.json`, `markerPath` builds `<markersDir>/<name>.completed` and
`clearMarker` deletes it, and `runIntegrationReview` builds `<logsDir>/integration-<name>.log`. A name
of `../../../../evil` escapes `stateRoot` in all four.

### Why the existing checks do not cover this

There are three containment-ish checks, and they are three different things:

| Site                                 | Question it answers                          |
| ------------------------------------ | -------------------------------------------- |
| `queue/clean.ts` `samePath` (`:106`) | Are these two paths _equal_?                 |
| `sequential.ts:99`                   | Are these two paths _equal_? (a second copy) |
| `queue/serve.ts:126`                 | Is this path _inside_ that root?             |

Only the third is containment, and it is inline in an HTTP handler. The two equality checks are correct
for their own narrow purpose (they refuse a worktree the runner did not place) and are not a
containment seam: equality against a runner-constructed path happens to imply containment, but the
implication is invisible, and neither covers the integration paths at all.

## Solution

One module owns containment, and every destructive or path-building call passes through it.

After this change:

- A path is deletable only when it is inside a root the caller names, _and_ it is a worktree or
  integration the runner has a registration for.
- An integration manifest is validated when it is read, so a hand-edited or agent-written field cannot
  become a path.
- An integration name that resolves outside its root is refused at the read, not at the delete.
- On Windows the delete reaches `rmdir` as an argv element that `cmd` cannot re-parse into a second
  command.

Operators see no intended behaviour change. A path that used to be deleted will still be deleted; a
path that was never a runner path stops being deleted, which is the fix.

## User Stories

1. As an operator, I want a recursive delete to refuse any path outside the directory the runner owns, so that a bad manifest can never delete my home directory.
2. As an operator, I want a path recorded in a manifest to be validated when it is read, so that a stale or hand-edited absolute path cannot redirect a delete.
3. As an operator, I want `integration-cleanup`, `queue clean`, and `queue land --recompose` to all reach the same containment check, so that a cleanup I start from a different subcommand has the same guarantee.
4. As an operator, I want the runner to refuse to delete a directory that is not a registered worktree or a known integration, so that a path I happen to own is never collateral.
5. As an operator on Windows, I want a worktree path containing `&`, `|`, `>`, or `^` to be deleted rather than interpreted, so that a directory name cannot execute a command.
6. As a maintainer, I want one function that answers containment, so that a new destructive call site cannot be added without passing it.
7. As a maintainer, I want the purity of that function — root, candidate, result — so that I can test the whole property as a table without a repo, a worktree, or git.
8. As a maintainer, I want the integration manifest validated against a schema on read, so that a missing or mistyped field surfaces as "manifest is invalid" rather than as `undefined` flowing into a path.
9. As a maintainer, I want an integration name that resolves outside its root to be refused at the read, so that four sinks are fixed by one check instead of four.
10. As a maintainer, I want `samePath` to become a caller of the shared path-normalisation, so that Windows case-folding lives in one place rather than two.
11. As a maintainer, I want the two equality checks to stay equality checks, so that "is this the worktree I placed?" and "is this inside a root?" remain distinct questions.
12. As a security reviewer, I want a spec that fails against the current code for each of the four sink families, so that the fix is demonstrated rather than asserted.
13. As a security reviewer, I want the `cmd.exe` sink covered by a test that would have caught the `&` split, so that the Windows path is not left as an untested branch.
14. As a consumer of `@lisachandra/sandcastle`, I want the changeset to say the manifest schema is now enforced, so that a manifest I wrote by hand and got wrong fails loudly instead of silently.
15. As an agent running in a worktree, I want the state root I write to be the one the operator will validate, so that a malformed artifact I produce is rejected rather than executed.

## Implementation Decisions

### The seam

One exported function owns containment. It takes a root and a candidate, returns a boolean, and is
pure: it resolves both, normalises case on Windows, and compares with a separator boundary so that
`/a/bc` is not inside `/a/b`. It does **not** touch the filesystem — a symlink-escape variant needs a
`realpath` step and is a separate decision (see Out of Scope).

Two adapters sit on top, and they are the only things call sites use:

- A **delete guard**: refuse unless `within(root, candidate)` _and_ the runner has a registration for
  that path (`registeredWorktrees()` for a worktree; a readable integration manifest for an
  integration). This is where `removeWorktree`'s missing check goes.
- A **path builder**: build a path from a fixed root plus a name, and refuse when the result is not
  contained. This is where `integrationManifestPath`, `markerPath`, and the integration log path go.

The distinction matters: containment is necessary but not sufficient for a delete. A file inside the
markers directory is contained, but only the builder's own output should be clearable.

### The manifest

`IntegrationManifest` gains a zod schema, mirroring what `queue/manifest.ts` already does for the queue.
Read validates and throws on a mismatch with the same wording it uses today. `name` additionally must
satisfy `integrationNamePattern` on read — the pattern already exists and is already applied to the
CLI argument; the gap is that the file content is trusted after that.

The `worktree` field becomes a **relative** path, and `integrationBasePath` resolves it against the
integrations root rather than `stateRoot`, refusing an absolute value. Existing manifests written by
this tool already carry a relative path, so the field's meaning does not change for them.

### The Windows delete

`removeWithRmdir` stops handing a bare path to `cmd.exe`. The reason `rmdir` is used at all is recorded
in the commit that introduced it: a worktree carries ~12,000 links and `rmdir /s` deletes a junction
itself without walking into its target, so it avoids a minutes-long sweep. That property must be kept.

The fix is to quote the path for `cmd` rather than to abandon `cmd`. A `cmd`-safe argument wraps the
path in double quotes and escapes `^`; with the path quoted, `&`, `|`, `>`, `<` lose their meaning. The
test for this must assert on the _argument passed_, not on a spawned process, so it runs identically on
both platforms.

### Where the delete guard sits

`removeWorktree` takes the guard as a required precondition, not an option. `completeWorktreeRemoval`
keeps its current exported shape (a test pins the missing-`.git` branch) but asserts the same
precondition. `unlinkWorktreeLinks` stops being reachable with an unvalidated root, which also removes
the junction-root sweep the scan found.

### What does not change

- `pushThenRemoveWorktree`, `ensurePersistentWorktree`, `validateExistingWorktree`, and
  `prepareIssueWorktree` keep their signatures and their existing refuse-conditions.
- `samePath` and the `sequential.ts` check keep answering equality. They are correct; they simply stop
  being the only thing standing between a manifest and a delete.
- The queue manifest's schema and the queue's own write path are untouched.

## Testing Decisions

A good test here asserts the _property_, not the call: "this path is refused", "this name cannot become
a path". It must not assert that a particular helper was called, and it must not depend on the platform
the suite happens to run on.

- **The seam**, as a table: a candidate equal to its root, one level down, a sibling sharing a prefix
  (`/a/bc` against `/a/b`), a `..` that escapes, an absolute candidate against a relative root, and the
  Windows case-fold pair. This is the whole containment property and needs no filesystem.
- **The delete guard**, over the four call sites the scan found: a manifest whose `worktree` is absolute,
  one whose `name` contains `..`, one whose `status` is terminal, and the happy path. Prior art:
  `queue/clean.test.ts` already drives `selectIntegrations` through a `readManifest` seam, and
  `integration/manifest.test.ts` already injects `ManifestFs`.
- **The manifest**, as a round trip plus a rejection: a valid manifest reads back unchanged; a manifest
  missing a required field, or with a name that is not an integration name, throws with the message the
  read path already uses. Prior art: the `queue/manifest.test.ts` schema tests.
- **The `cmd` argument**, as a pure formatting assertion: a path containing `&`, a space, and a caret
  produces a quoted argument. No process is spawned.

No new seam is introduced for the tests — the path functions are already pure, and both filesystem and
git are already injectable at the modules that need them.

## Out of Scope

- **Symlink and junction escape.** `within` compares resolved paths; a legal path that is itself a
  symlink out of the root passes. Closing that needs a `realpath` step and a decision about what to do
  when the target does not exist. Recorded separately.
- **The child-process seam** (slice C): provider command strings, `countNewCommits`'s shell string, the
  `agent-wrapper.sh` double evaluation, and session-id validation. Different module family.
- **The item-mutation policy** (slice B) and **the admin guard** (slice A, #46).
- **`queue serve`.** The `decodeURIComponent` crash and the missing method/origin/host checks are in the
  same package but a different subsystem; filed separately.
- **`scripts/hoist.mjs`.** The `..`-collapsing staging path and the `cmd.exe /c mklink` call are repo
  tooling, not the sandcastle package.

## Further Notes

The three existing checks were not wrong; they were answering their own questions. The defect is that
no module answered the _deletion_ question, so each new sink inherited "no check" by default. That is
the deepening this issue buys: a new destructive call site now inherits a check it cannot skip.

The architecture review for this run (`temp:/architecture-review-2026-11-10.html`) places this candidate
first on the grounds that the architecture defect _is_ the critical vulnerability, and that the
containment property is the cheapest thing in the repo to prove.

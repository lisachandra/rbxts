---
"@lisachandra/sandcastle": patch
---

fix(sandcastle): one containment seam for runner-owned paths

The runner creates, merges, and recursively deletes directories, and it had no module that owned the
question "which directories may I delete?". The question was answered — or not asked — at each call
site, so one unchecked field could reach a recursive delete and a Windows command interpreter.

**One predicate, two adapters.** `within(root, candidate)` answers containment: it resolves both
paths, folds case on Windows, and compares by path segment so `/a/bc` is not inside `/a/b`. It never
touches the filesystem, so the whole property is a table test with no repo, worktree, or git. On top
of it: `assertWithin` refuses with a message naming both paths, and the delete guard refuses unless
the path is inside the state directories of the repository that owns the removal.

**The integration manifest is validated on read.** It was `JSON.parse(...) as IntegrationManifest`, so
a missing field became `undefined` in a path and a hand-edited one became any path at all. It is now
zod-validated, `name` must satisfy the same pattern the CLI argument already did, and `worktree` must
be **relative** — an absolute value replaces the root in `path.resolve`, which put an arbitrary
directory in reach of the delete. A mismatch throws the wording the reader already used,
`Integration manifest is invalid`, now naming the field.

The recorded `worktree` is also checked to be inside **that integration's own directory**, not merely
somewhere under the integrations root: the wider root would let one integration's manifest point at a
sibling's worktree, so cleaning `a` would delete `b`.

**Path builders refuse.** `integrationManifestPath`, the new `integrationLogPath`, and `markerPath`
validate the name and assert containment, so all four sinks a name reached are fixed once rather than
four times.

**Deletes refuse paths the runner does not own.** `removeWorktree` and `completeWorktreeRemoval` take
the guard as a required precondition, not an option, because their callers arrive from manifest fields
and queue state that an agent inside a worktree can write.

**The Windows delete is quoted.** `cmd.exe` re-parses everything after `/c`, so a directory name
containing `&` split the command and the remainder ran at the operator's privilege. The path is now
wrapped in double quotes with `^` doubled, asserted on the argument (`rmdirArgs`) rather than on a
spawned process, so the spec means the same on every host. The `rmdir /s` fast path is unchanged: it
deletes a junction itself without walking into its target, which is why it exists.

`PrintCommand` and every public signature are unchanged apart from the guard's new required
precondition. An operator-authored manifest that was silently accepted can now throw; that is the
fix, and it is why this is a patch rather than a silent behaviour change.

The guard answers containment only, not ownership. "Did the runner place this worktree?" stays with
the family that can answer it — `selectIssueWorktrees` by equality with `worktreePathForBranch`,
`integrationBasePath` by the manifest it refuses without — because re-deriving it at the delete would
make every hand-built fixture register with git first and still prove nothing the caller did not
already know. `registeredWorktrees` gained an optional `cwd` so a caller acting on another checkout
asks that checkout, which is the part of the ownership question the seam could cheaply own.

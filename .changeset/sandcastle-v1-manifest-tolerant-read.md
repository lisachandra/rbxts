---
"@lisachandra/sandcastle": patch
---

fix(queue): read a version 1 manifest instead of refusing it

`readQueueManifest` threw on `version === 1` and told the reader to run `queue migrate --apply`. That
is unusable from the one place it matters most: the manifest resolves against the **primary**
checkout, so a worktree created from a pre-migration base reads the shared v2 file with its older
compiled code — and that older code refused it. `queue list` and `queue check` therefore failed in
exactly the worktrees that still needed to read the queue, and the failure named a command the old
build does not have.

The read now translates a v1 file through `migrateQueueManifest` — the same implementation
`queue migrate` writes with, moved to `queue/translate.ts` so `manifest.ts` can call it without a
module cycle, and re-exported from `queue/migrate.ts` so import sites are unchanged. There is still
exactly one translation.

A read never writes: `updatedAt` in the returned object is regenerated and the file is untouched until
`queue migrate --apply`. A v1 batch with no `mergeName` cannot be translated without guessing which
integration it becomes, so it is refused by name with the `--assign` instruction — the same refusal
`queue migrate` gives.

The schema version is unchanged at 2, and `queue migrate` remains the only write path. Fixing a fold so
it no longer leaves an empty `roles: {}` on the folded batch is part of the same change: the empty
record is schema-valid, so it would have been written into the committed manifest as if someone had
cleared the roles deliberately.

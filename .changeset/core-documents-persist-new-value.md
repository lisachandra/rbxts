---
"@lisachandra/core": patch
---

Persist a changed document instead of only removed ones

The `documents` middleware derived its write set from
`removeValues(oldValue, ...values(newValue))`, which keeps a key only when its _value_ is absent
from the new record. A changed value is therefore never a difference: every update to a document
that already existed was silently dropped, and the profile kept whatever it was last seeded with.
The middleware now writes each key that is new or whose data changed.

Removing a key from the store still leaves its persisted data alone, which is the behaviour the
existing spec pins.

The decision moved into `documentsToPersist` in `@lisachandra/core/utils/documents` because the
middleware itself is unreachable in the test suite: it is registered inside `if
(RunService.IsServer())`, and the offline emulator always boots a client, so the middleware never
exists during a run. A spec that drove the middleware read the profile's template back and failed
for a reason unrelated to this logic — the removal spec had been failing that way, hidden behind its
`reeparityPaths` exclusion entry. The extracted function is what the specs cover; the middleware
calls it.

The comparison is `equalsDeep`, not `equals`: sift's `equals` compares nested tables by reference,
and a store update that changes any field rebuilds the document table, so a reference comparison
would report every touched document as changed and spend a write on each.

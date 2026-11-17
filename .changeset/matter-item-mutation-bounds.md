---
"@lisachandra/matter": patch
---

Bound item mutation requests and stop a stale pointer from aborting the item tick

`DropItem` carried a client-supplied `amount` straight into item arithmetic. `removeItem` clamped
the upper bound with `math.min(amount, stack)`, so `0` survived, left the stack untouched, and minted
a zero-amount item under a **fresh GUID** that was then spawned as a ground entity. One packet burned
one of 65536 GUIDs and created one live entity; repeat until the space is exhausted, at which point
item replication halts on `Log.Fatal`. The mutation policy now lives in
`@lisachandra/matter/utils/item/mutation` and rejects an amount below 1 before any arithmetic, so a
rejected request leaves item state and the GUID space untouched.

The same module answers "does the owner still hold this?" once, for both move and drop. The move path
used to assert the answer with `getItemFromGUID(world, guid)!`; when a pointer was live but the item
was gone, that threw out of `system()` and discarded every other player's queued packet for the frame,
because `useMessage` had already removed them from its queue. A miss is now a logged `Log.Warn`
rejection and the remaining packets still apply.

The enabler was `cleanupItemPointers`: its predicate `record.old.items.some((item) => key !== item.guid)`
is true for every key as soon as the removed component held two items, so pointers outlived their items
and nothing was ever cleaned. It now drops the pointers of exactly the items the removed component held,
and still keeps them when the ground entity's items were moved to another container.

`MessageData` is unchanged — `amount` stays a Serio `u16` — and the 15-stud pickup range is unchanged.

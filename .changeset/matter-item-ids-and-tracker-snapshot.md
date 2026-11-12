---
"@lisachandra/matter": patch
---

Give every item path a distinct numeric ID, and stop handing out the replication tracker's live set

**Item IDs collided.** `createItemRegistry` incremented its counter _after_ recursing, so a parent
and its first child were assigned the same number: for `{ None, Consumable: { Potion } }` both
`Consumable` and `Consumable.Potion` received `1`. Two items sharing one wire ID made
`getItemIdFromNumericId` return whichever path map iteration yielded last, so the same round-trip
returned `["Consumable", "Potion"]` in one run and `["Consumable"]` in another.

The counter is now pre-order — a node takes its ID before its children are visited — so each path
reaches `itemId++` exactly once. This changes the numeric ID assigned to any item that follows a
parent in the tree, so a persisted numeric ID from an earlier build will not match. Numeric IDs are
wire/persistence values, not a stable public constant; re-derive them from `getNumericItemIdFromId`
rather than storing a literal.

**`ReplicationTracker.entitiesFor` returned its internal `Set`.** A caller could `clear()` or
rewrite a player's known entities without the tracker knowing, which undercut the seam that #4
introduced. It now returns a snapshot, so state changes go through `trackEntity` and
`forgetEntity` only. `forgetEntity` is new: the reconciliation in the server replication system
used to express "this player no longer sees these" by clearing the live set, and now says it
directly.

`test/matter` covers the distinct-ID invariant, `forgetEntity`, and the snapshot guarantee; the
`itemList` codec specs derive the Sword ID from the registry instead of hardcoding `0`, which only
held because of the collision.

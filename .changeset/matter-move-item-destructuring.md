---
"@lisachandra/matter": patch
---

Fix `moveItem` so it can complete a move at all

Every `moveItem` call threw `attempt to index nil with 'items'`: inventory→hotbar, hotbar→inventory,
and ground pickup alike. The function destructured one multi-value `world.get` through an array cast,
which told roblox-ts the result was an ordinary tuple — so it compiled to indexing the _first_ return
value (`local inventory = component[1]`) instead of binding both returns. Both containers were nil
and every branch dereferenced one.

The cast is gone and the destructuring compiles as the multiple-assignment it always should have been.
The two `!` assertions that guarded "the entity has no such container" are now named `assert`s with
the failing container in the message, so a caller that moves an item on an entity missing its
Inventory or Hotbar gets a diagnosis instead of a nil index.

`test/matter/src/itemLifecycle.spec.ts` previously pinned the crash as three defect observations; the
same three specs now assert the transfers — the item leaves the source, arrives in the destination
with its GUID, and a ground pickup marks the source entity `moved`.

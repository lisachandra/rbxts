---
"@lisachandra/matter": patch
---

Stop `useDocument` poisoning a discriminator, and make the no-player overload load

Two paths skipped the cache write after claiming a load with the `LOADING` sentinel: a player who
left mid-load, and a call with no `player` at all. Neither cleared the sentinel, and only
`on_closed` ever deleted an entry — so a later call for that discriminator saw the sentinel,
concluded a load was in flight, and started nothing. A player who rejoined inside one server lifetime
was never loaded again, with no warning and no kick.

- **The slot is cleared on every path that does not cache.** A leaver's abandoned load and a failed
  load both release their claim, so the next call retries.
- **Omitting `player` no longer means "the player left".** The check is `player !== undefined &&
!player.Parent`; the overload loads and caches the document without a kick target, which is what its
  signature always promised.
- **The retry is bounded.** A failed load increments a per-discriminator count and clears its slot;
  after three failures the hook stops touching the store and kicks the player who supplied one, rather
  than polling a DataStore that is not answering — `waitForPlayerLoaded` polls once a second and a
  render loop can poll every frame, so an unbounded reset is a load storm.
- **A late close cannot evict a live session.** `on_closed` only deletes the slot when it still holds
  the profile that closed, so a rejoining player's profile is not removed by the previous one's
  callback.

The two specs that pinned the sentinel as a defect now assert the fix, and a third drives the bound
through a closed Dataforge store (whose `load` answers `store_closed` without yielding) and checks
that the player is kicked exactly once.

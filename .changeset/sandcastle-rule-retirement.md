---
"@lisachandra/sandcastle": minor
---

Serialization rules can now be retired, so a queue can be brought back to "no drift"

`queue rule --delete --name <R#>` removes every rule carrying that name (one name may cover
several issue sets), `--issues <a,b>` matches the rule whose sorted issue set is exactly that,
and both together intersect. The command goes through the normal locked manifest write, prints
each rule it retired, and exits non-zero naming the rule when nothing matches — it never
silently no-ops. `--delete` is now accepted for `queue rule` (it stays reserved to `queue
sequence` otherwise), and the required-args gate only demands `--issues`/`--reason` when not
deleting.

The sorted issue set remains the add key, so narrowing a rule is retire-then-redeclare rather
than an upsert: re-declaring a name with a narrower set still appends, which is exactly the
append-only wart this unblocks cleaning up. A spec covers add → retire → re-declare narrower →
drift zero.

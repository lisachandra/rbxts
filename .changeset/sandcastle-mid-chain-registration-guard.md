---
"@lisachandra/sandcastle": minor
---

Registering a queue member ahead of an already-dispatched one is now refused

`queue add --sequence <batch> --after <m>` throws when any later-position member of that batch
has a `.sandcastle/state/<n>.json` — the marker the runner writes when it dispatches an issue —
because each member's branch becomes the next member's base: an insertion ahead of a dispatched
member leaves that branch behind the insertion and `queue land` refuses the moved tail. This is
the harness-level guard behind the prose contract that already forbade it; the prompt text now
says the harness enforces it.

The refusal names the dispatched member, the batch, and the fix: append to the batch tail
instead (omit `--after`), or register the work gated. Tail appends and gated/human placements
are untouched, and dry-run reports the same refusal without writing.

---
"@lisachandra/sandcastle": minor
---

feat(sandcastle): queue graph shows parallel lanes, not one serial chain

`queue run --parallel <n>` runs up to `n` batches at once, but `queue graph` drew the manifest as a
single run order — so the artifact a human reasons about the queue with could not show what the
dispatcher would do. Batches that share a lane and the `after` gate or `R<n>` rule that separates
them were both invisible.

The graph now ranks batches by the rule set `selectNextBatch` enforces: an unmet `after` gate and a
serialization-rule conflict are barriers, and nothing else is. Run order, member position, and live
blockers are not, because the dispatcher does not treat them as waits. Each rank names the
`agents.catalog` profile its lane would draw, resolved through `profileForLane` — the same function
the pool calls, so a catalog shorter than the parallel limit wraps the way the run does instead of
claiming later slots run nothing.

Only rank 1's lane pairing is fixed. Slots are handed out in fire order, so a later batch takes
whichever lane frees first; the page says that rather than inventing a pairing.

`queue lanes` appear in all three renderings: a `subgraph` per rank in the Mermaid diagram (the
compact one — `--issues` is the composition view, and Mermaid nests badly), a **Parallel lanes**
section on the Markdown page, and a block before the edge list in the terminal preview.

`queue.parallel` of 1 renders byte-identically to before, and the JSON payload gains `lanes` only
when the queue is actually parallel. A parallel queue with no `agents.catalog` says so instead of
naming a profile, because `queue run --parallel` refuses in that state.

An `after` cycle now ranks its members together in one rank instead of recursing: they wait on each
other, so neither ever fires, and counting the back edge would shift every downstream rank.

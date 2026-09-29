---
"@lisachandra/sandcastle": major
---

Give the queue a landing step, and one name per batch. A batch's `name` is now its integration name
(`sandcastle/integration/<name>`) — the v1 split between a short code and a separate `mergeName` was
two namespaces for one thing — and `afterMerge` is now `after`, so the manifest schema is version 2
and `readQueueManifest` refuses a v1 file by name. `sandcastle queue migrate` translates one: it
prints every rename, fold, and remapped `after`/`joins` value as a proposal, writes it only with
`--apply`, and refuses to guess at a batch v1 left unnamed unless `--assign <old>=<integration-name>`
supplies it. Two v1 batches that claimed one integration now fold into a single batch (member order
preserved, dropped notes reported) instead of being coordinated by prose.

`sandcastle queue land --name <batch>` closes the seam between "the agents finished" and "it is on
main": it composes the batch on its integration branch — conflict resolution and the integration
review are agents, and an unfinished composition resumes rather than restarting — then prints the
`git push` and `gh pr create` commands, or runs them under `--create-pr`. The PR body carries one
`Closes #<n>` per member, so merging it closes the batch's issues natively, which in turn clears
their `blocked-by` edges for later batches. The merge itself stays human: nothing in sandcastle runs
`gh pr merge`. `queue run --land` lands each batch it dispatches, `queue land --finish` removes a
batch whose members have closed and clears the `after` references pointing at it, and
`queue sequence --delete` refuses while another batch still waits on the batch being deleted. Dangling
`after` references are reported as drift by `queue list` / `queue check`.

Every batch already branched from `--base`, so nothing stacks on an unlanded integration; the docs,
help topics, and the bundled skill now say so in one place, and `queue bootstrap` proposes batch names
in the `<scope>-work` shape an integration name needs.

This is a breaking change for any existing `sandcastle.queue.json`: run `sandcastle queue migrate
--apply` (adding `--assign` for batches v1 left unnamed) before the next `queue list`.

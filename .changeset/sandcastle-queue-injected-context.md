---
"@lisachandra/sandcastle": patch
---

refactor(sandcastle): run every queue subcommand through one injected context

`queue/commands.ts` and `queue/ops.ts` are the layer that composes the queue's modules, and it was
the only layer that took nothing as a parameter: `readQueueManifest()`, `fetchLiveQueueState({ … })`,
and `unmetIntegrationGates({ … })` ran at their module-global defaults, output went through
`console.log`, and a halt went through `io.exit`. Nothing outside the process could make it behave
and nothing inside could observe it, so the behaviors a human depends on had no suite at all.

They now take a `QueueContext` — read, fetch, evaluate gates, transact, write, print, exit — built
once at the CLI edge. `main.ts` passes it explicitly; `runQueueCommand`'s parameter is optional and
defaults to the same constructor, so the published signature keeps working.

No subcommand, flag, message, exit code, or manifest byte changes. Two suites cross the new seam:
`commands.test.ts` drives `queue check`'s 0/1/2 exit codes, `queue list --json`, and the
disabled-queue split from canned live state; `ops.test.ts` asserts each mutation as the (message,
manifest) pair the transaction settled on, replacing a fixture that relocated the manifest by
mutating the global config and stubbing git.

Also fixes `queue promote --apply`, which `help.ts` documents and `ops.ts` implements but which
`cli.ts` refused: the `--apply` guard written for `queue bootstrap` and `queue migrate` did not list
`promote`, so the bulk form of a gate promotion was unreachable. The single-gate form was
unaffected.

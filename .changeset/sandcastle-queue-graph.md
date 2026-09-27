---
"@lisachandra/sandcastle": minor
---

Add `sandcastle queue graph`, the queue rendered for a human: batches as nodes in run order, with edges for `afterMerge` gates, `serialized` rules, and live cross-batch blocked-by links. Mermaid is the default (GitHub draws it natively in files, issues, PRs, and comments), `--format json` prints the payload for tooling, `--format ascii` previews it in a terminal, `--write <path>` emits a timestamp-free Markdown page a CI drift check can diff, `--comment <n>` posts that page to a tracker issue and updates its own comment on re-run, and `--expand-issues` draws each batch as a subgraph of its members. The command is read-only and never writes the manifest.

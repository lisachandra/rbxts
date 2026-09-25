---
"@lisachandra/sandcastle": minor
---

Give every command its own `--help`: `sandcastle <command> --help` and `sandcastle queue <subcommand> --help` print that command's usage, flags, and exit codes instead of the shared global dump, and help is answered before argument validation, so `sandcastle queue add --help` no longer errors. `sandcastle queue run` exits 1 when nothing can fire (unknown `--name`, exhausted queue) so a scripted run fails loudly, `--json` reports each decision as one JSON object, and `sandcastle queue prune --closed` (`--dry-run` reports first) drops references to closed issues — the state that otherwise gates a batch forever.

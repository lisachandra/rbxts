---
"@lisachandra/sandcastle": patch
---

Stop provider commands being assembled out of unescaped strings

Every provider built its `PrintCommand.command` by interpolating values into one string. A model id,
an effort, a wrapper path, and — the dangerous one — a session id resumed from disk all went in
unguarded, and upstream spawns the result through `sh -c`. A session id is chosen by the agent on its
own stdout, persisted, and interpolated again on the next retry, so a prompt-injected agent could put
`; rm -rf …` there and it would run as a command.

`src/child-process.ts` is now the one place commands are built:

- `CommandSpec` is a program plus an argument list, never a pre-joined string.
- `shellQuote` single-quotes one value for POSIX shells (`'` → `'\''`); `toShellCommand` quotes every
  argument by construction, so no call site formats a command itself. dirac, zcode, and the marker
  wrapper all go through it.
- `runCommand` spawns argv with no shell at all, which is what `countNewCommits` now uses: it was the
  package's only remaining shell-string git call, and it interpolated a `--base`/config/state-file ref.
- `assets/agent-wrapper.sh` evaluates exactly the one payload argument (`bash -c "$1"`) instead of
  re-joining `"$*"`, which destroyed the argument boundaries the quoting exists to preserve.

Session ids are also validated at the boundary rather than trusted downstream. `isValidSessionId`
accepts a bounded token (`^(?!-)[A-Za-z0-9._:-]{1,128}$`) and both capture and store reject anything
else. The leading-dash exclusion is not cosmetic: a dash-prefixed value is read as an option before it
ever reaches a shell, and zcode's `parseArgs` ignores unknown flags — so `--dangerously-skip-permissions`
captured as a session id would have silently escalated the next attempt.

`--base` and `--model` are likewise rejected at the CLI when they are not a ref or a model id, so an
operator typo cannot become a command-shaped value in the first place.

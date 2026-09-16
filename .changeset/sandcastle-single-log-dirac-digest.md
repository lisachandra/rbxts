---
"@lisachandra/sandcastle": patch
---

Simplify agent logs back to one live file, plus a dirac-only digest.

- `.log` files are plain upstream file-mode logs again (`FileDisplay` output
  with `verbose: true`, matching pre-split behavior). The split-file
  machinery (`splitFileLogging`, `postProcessAgentLog`, `.raw.log`,
  `.readable.log`) is removed; leftover `.raw.log` / `.readable.log` files
  from earlier runs can be deleted.
- Dirac runs additionally stream a clean markdown digest
  (`issue-<n>.dirac.log`, same rendering as the old `.readable.log`) live as
  agent events arrive, so the readable output exists from run start and
  survives failures — no more waiting for an end-of-run post-process step.

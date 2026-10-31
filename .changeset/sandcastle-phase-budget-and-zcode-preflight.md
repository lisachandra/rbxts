---
"@lisachandra/sandcastle": minor
---

Bound agent phases with a wall-clock budget and persist zcode sessions write-through

The zcode implement run for the game repo's issue #365 hung for six hours: the
agent got stuck repairing a Windows file-locked `pnpm install`, then polled the
wedged install in 10-minute background blocks. Every poll emitted tool events
and the zcode wrapper emits 120s keep-alives, so upstream's idle watchdog never
fired; no wall-clock budget existed; and when the process tree was finally
killed externally, the captured zcode session id died with it because
persistence ran only at attempt end.

- Every marker-backed phase attempt (design/implement/review, planner,
  integration resolve/review) now runs under `SANDCASTLE_PHASE_BUDGET_MINUTES`
  (default 120, `0` disables). On expiry upstream's abort signal kills the
  agent's whole process tree (`taskkill /T /F` on Windows) and the phase throws
  `PhaseBudgetError`, which the retry loop treats as transient — the next
  attempt resumes the captured session via `--resume-session`.
- Session ids now persist write-through: `fileLogging` gained an
  `onSessionCaptured` sink that fires the moment the raw stream announces the
  id, so an externally killed attempt still leaves a resumable session.
- zcode model/effort selections are validated at agent construction against the
  same provider configs the wrapper injects (`ZCODE_BUILTIN/PERSONAL_PROVIDER_CONFIG_FILE`,
  desktop-install and `~/.zcode` defaults). An unregistered model, a disabled
  provider, or an unsupported reasoning effort now fails fast with the
  available ids in the message instead of surfacing mid-phase as the fatal
  「Provider Registry 中不存在 Model」. Conservative by design: unknown
  providers, unreadable configs, or empty models never block dispatch.
- The zcode wrapper's legacy `part.*` tool path called a helper that was
  referenced but never defined; a terminal legacy tool event would crash the
  readline handler. The helper now exists, pinned by a stub-driven test.

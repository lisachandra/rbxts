---
"@lisachandra/sandcastle": minor
---

feat(sandcastle): resume agent sessions on pi, codex, and claude-code

The three upstream-backed adapters kept `captureSessions: false`, so a phase that died mid-run
restarted the agent from scratch on every retry. `closes #43` continues the work in #39, which did
this for dirac and zcode.

Nothing about upstream needed building: it already ships `sessionStorage`, the resume flag in each
`buildPrintCommand`, and a `session_id` stream event. The adapters were simply turning it off.

- `createSessionCapture` now recognises each CLI's own announcement shape: pi's
  `{"type":"session","id"}`, codex's `{"type":"thread.started","thread_id"}`, and claude-code's
  `{"type":"system","subtype":"init","session_id"}`. The backends that cannot resume are
  deliberately still absent — storing an id for one would turn its fresh start into a hard failure,
  because upstream's precheck refuses any `resumeSession` on a provider with no storage.
- `isStaleSessionError` now matches upstream's own refusal, `resumeSession "<id>" not found`. It is
  what the precheck throws before spawning anything, in both sandbox modes. Without the pattern the
  retry loop offers the same pruned id forever: a "not found" reads as transient, so the phase never
  fails and never progresses. Bare "not found" is still not a pattern — a missing binary says nothing
  about the session.
- Session ids resume as `pi --session <id>`, `codex exec resume <id>`, and `claude --resume <id>`.
  No `--fork-session`: the phase runner continues the same conversation rather than branching it.

The two stores keep their separate jobs. Sandcastle's store is the ledger — which session belongs to
this phase scope, and which backend produced it, so a scope that switched backend starts fresh.
Upstream's `findByIdOnHost` is the existence precheck — the CLI wrote the file, so only it can say
whether the id still resolves. Taking either over the other would lose the scope binding or offer ids
the CLI has pruned; neither replaces the other.

`SANDCASTLE_NO_SESSION_RESUME=1` still disables resume entirely.

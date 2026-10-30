---
"@lisachandra/sandcastle": minor
---

Retry agent phases indefinitely on transient provider failures

A provider hiccup used to fail the whole run: the phase retry layer only matched
rate-limit errors (`429` / `rate limit` / `quota exceeded`), so an HTTP 500 or a
connection reset from the model endpoint — e.g. thehive.ai's
`wsarecv: An existing connection was forcibly closed by the remote host` during
the issue #398 review run — marked the phase failed on the first occurrence and
left the remaining phases unrun.

- `runPhaseWithRetry` now retries every error indefinitely by default and is
  generic, so the planner (`runAll`) and the integration resolve/review phases
  get the same persistence as the design/implement/review phases. Backoff starts
  at 30s and doubles to a 5-minute cap; progress is logged every 10 attempts with
  elapsed time.
- Only fatal errors propagate immediately: bad credentials (401/403, invalid API
  key), unknown model/config (「Provider Registry 中不存在 Model」, `无法定位`),
  and missing binaries — errors no retry can fix.
- Set `SANDCASTLE_PHASE_MAX_RETRIES` to cap the retries per phase when
  persistence is unwanted; an explicit `maxRetries` argument still overrides it.
- Each retry starts a fresh agent session: worktree contents, plan files, and
  commits carry continuity, but conversation context restarts (session resume
  via `session/resume` remains tracked in issue #39).

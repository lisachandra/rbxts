---
"@lisachandra/sandcastle": patch
---

Give zcode runs dirac-level log parity and desktop-app visibility

Three gaps between a zcode issue run and a dirac one:

- Tool calls were invisible. The wrapper reduced every tool part to
  `{name, state}` and dropped input/output, and neither the provider nor the
  digest renderer had a branch for those lines — so even a successful zcode
  run produced a near-empty `issue-N.digest.log` while dirac's showed
  `> Executed: <command>` with exit code and output. The wrapper now emits a
  `detail` excerpt (input/command, output, error, capped at 400 chars) on
  terminal tool states, the provider maps them to upstream's typed
  `tool_call` events, and the digest renders them dirac-card-style:
  `> bash (completed)` + the detail body.
- Wrapper notices (permission auto-answers, user-input cancels) only went to
  stderr; they now also flow into the stream as `{type:"note"}` lines, which
  land in the raw `.log` via upstream's stdout tee.
- Sessions were created with `persistence:"deferred"`, which zcode only
  persists after a completed turn — a crashed run left nothing in the store,
  so the session was invisible in the ZCode desktop app. The wrapper now
  creates sessions with `persistence:"immediate"` (and re-enables title
  generation), so runs appear under their workspace even when they die
  before the first turn completes.

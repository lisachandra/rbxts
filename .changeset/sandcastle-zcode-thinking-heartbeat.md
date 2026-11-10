---
"@lisachandra/sandcastle": patch
---

Keep zcode runs alive through long pure-thinking stretches

The wrapper's keep-alive heartbeat (the line that feeds @ai-hero/sandcastle's
600s idle watchdog) was re-armed by every `model.streaming` event — including
`reasoning_delta`, which the wrapper deliberately drops from stdout. A model
that thought in an unbroken reasoning stream (glm-5.3-flash at max effort
thinks > 10 minutes) therefore emitted no stdout for the whole stretch, and
upstream killed the phase with `AgentIdleTimeoutError: Agent idle for 600
seconds` mid-thought. This is the design-phase failure seen on
rocket-powered-blox-cars #174: 32 minutes of healthy thinking, zero
`keep-alive` lines, one 600s idle kill.

Only stdout-producing events re-arm the heartbeat now: reasoning deltas and
deduplicated tool snapshots keep the heartbeat live during thinking, so
keep-alives reach upstream every 120s no matter how long a thinking stretch
lasts. The interval is tunable via `ZCODE_SANDCASTLE_HEARTBEAT_MS` (min 100ms)
for testing.

Also pins, as an e2e test against the stub app-server, that a `/goal` prompt
prefix is delivered to `session/send` verbatim: sandcastle drives zcode
through the app-server protocol, which does not interpret slash commands
(only `zcode -p` does), so `/goal` on sandcastle prompts is model-visible
plain text — it does not activate zcode's goal system and does not affect the
idle watchdog.

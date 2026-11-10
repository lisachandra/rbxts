---
"@lisachandra/sandcastle": patch
---

Disable subagent spawning in headless zcode runs via `ZCODE_SANDCASTLE_DISABLE_SUBAGENTS=1`

Sandcastle agents talk to the real zcode app-server, which loads subagent
definitions from `~/.zcode/agents` and the worktree's `.zcode/agents` — so a
headless issue run could spawn subagents (extra plan-quota spend, wandering
runs nobody is watching). With the new env var the wrapper advertises
`subagentRuntimeConfigEnabled` and answers `subagents/readRuntimeConfig` with
the built-in-fallback snapshot: zero runtime profiles AND no plugin agent
definitions, so the session has no subagent types at all. Behavior is
unchanged unless the env var is set.

The stub app-server now issues the client-bound preferences/definition
requests up front and captures the wrapper's answers (`STUB_RUNTIME_PREFS_FILE`),
with e2e tests pinning both branches.

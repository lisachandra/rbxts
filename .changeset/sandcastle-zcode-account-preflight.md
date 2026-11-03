---
"@lisachandra/sandcastle": minor
---

Serve plan-mode zcode account providers headless via host delivery

Selecting `account:zai-start-plan/GLM-5.3-Flash` passed the model preflight
but died at session/create with 「Provider Registry 中不存在 Model」: the
wrapper spawns a standalone `zcode app-server`, and entitlement for plan-mode
`account:*` providers is host-supplied protocol state — the desktop app
pushes an entitled account snapshot to the agent and answers a runtime-header
request before each model call, while a bare app-server starts with every
plan provider unentitled (and its standalone credential-store mode is
unreachable from the protocol bootstrap).

The wrapper now plays that host role: for an `account:*` model selection it
delivers `provider/updateAccountConfig` — an entitled snapshot for the
selected provider, keyed to the injected builtin catalog's revision string
(`zcode-builtin:<n>:<sha256(abs path)>`, which the registry compares before
accepting a snapshot) — and answers `interaction/requestProviderRuntimeHeaders`
from the shared zcode credential store (`~/.zcode/v2/credentials.json`):
`start-plan` reads `zcodejwttoken` (falling back to
`oauth:<accountType>:access_token`, matching the desktop's answer),
`individual-coding-plan` reads the per-provider
`account-provider:coding-plan:<id>:account:<identity>:api-key` entry.
Credential values are decrypted in memory only (same AES-256-GCM scheme and
`ZCODE_CREDENTIAL_SECRET` override as the CLI) and never logged; a missing
credential surfaces as an actionable -32031 turn error. Other plan modes
(team-coding-plan, off-peak, highspeed) respond non-applied with a clear
message.

The zcode preflight's account check now verifies the credentials that answer
needs (key names only — store values are never inspected) instead of
rejecting plan modes as desktop-only, so a selection that will fail mid-turn
fails at dispatch with the missing key named.

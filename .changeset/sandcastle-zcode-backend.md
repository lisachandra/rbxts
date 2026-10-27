---
"@lisachandra/sandcastle": minor
---

Add a `zcode` agent backend and generalize the readable digest.

`--agent zcode` drives the ZCode CLI headlessly through its `zcode app-server` stdio
protocol (the same wire protocol paseo's zcode provider speaks). Binary discovery order:
`ZCODE_SANDCASTLE_BIN`, `zcode` on `PATH`, then the ZCode desktop app's bundled
`zcode.cjs` (run via `node`). Auth is zcode's own OAuth, so no API keys are needed in
`.sandcastle/.env`. Model ids are `"<zcode-provider-id>/<modelId>"` pairs from zcode's
registry; `--reasoning-effort` maps to zcode's per-model thought levels (`xhigh` becomes
`high`, since zcode has no `xhigh`). The repo's `sandcastle.config.ts` now defaults to
`zcode` with all phases on `…/th/glm-5.3-flash`; `dirac` and `pi` remain available.

The per-phase readable log digest is now backend-neutral: `diracDigestPath` →
`digestPath`, and `<name>.dirac.log` → `<name>.digest.log`, streamed for both `dirac`
and `zcode` runs.

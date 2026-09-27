---
"@lisachandra/sandcastle": minor
---

Add `sandcastle queue serve`, an interactive local view of the queue graph. The command starts a `node:http` server on `127.0.0.1:4321` (see `--port`, `--host`, `--open`) that serves a React + xyflow page from `dist/web` alongside two JSON endpoints, `/api/graph` and `/api/queue` — both built from the same `computeQueueView` the CLI renders, so the page and `queue list` cannot disagree. `?strict=1` reads the strict-gate view and `?refresh=1` bypasses the 30-second cache in front of the `gh` reads. The page lays batches out left to right with `@dagrejs/dagre`, draws gates, rules, blockers and the run-order spine as separately toggleable edge layers, filters batches by status, opens a per-batch panel with its members, roles, blockers, notes and merge branch, links GitHub issues, and deep-links a batch as `?batch=<name>`. Read-only, local-only, and gated behind `dist/web` having been built (`pnpm build`).

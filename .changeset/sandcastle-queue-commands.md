---
"@lisachandra/sandcastle": minor
---

Add a `sandcastle queue` command group (`add`, `sequence`, `rule`, `remove`, `list`, `check`) backed by a git-tracked `sandcastle.queue.json` manifest (path configurable via `queue.file` in `sandcastle.config.ts`). GitHub issues stay canonical for issue state; the manifest records batch composition/run order, serialization rules, and gates. `queue list` renders a live READY/GATED view with drift detection, and `queue check` exits non-zero when the queue and GitHub disagree. Review prompts now register follow-up issues via `sandcastle queue add` and verify with `sandcastle queue check` instead of hand-editing consumer markdown queue docs.

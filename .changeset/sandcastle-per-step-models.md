---
"@lisachandra/sandcastle": minor
---

Add per-step agent/model/effort overrides for every agent-driven step
(`design`, `implement`, `review`, `planner`, `resolve`, `integrationReview`).

- `sandcastle.config.ts`: `agents.steps.<step>` accepts `{ backend, model, effort }`;
  missing fields inherit the workflow default (`--agent` / `--model` / `--effort`
  plus `agents.models`).
- CLI: `--<step>-model`, `--<step>-agent`, `--<step>-effort` flags (for example
  `--design-model`, `--implement-agent`, `--review-effort`, `--planner-model`,
  `--resolve-model`, `--integration-review-model`).
- Precedence is CLI flag over `agents.steps` config over the workflow default.
  When a step selects a different backend without its own model, the mapped
  `agents.models[backend]` wins over the workflow model.
- Issue runs thread `steps.design` / `steps.implement` / `steps.review` through
  design, implement, and review, persist them as `phasesConfig` in
  `.sandcastle/state/<issue>.json`, and re-evaluate the implement phase against
  its own model. `runAll` uses `steps.planner`; integrations use `steps.resolve`
  and `steps.integrationReview`. `--dry-run` and `--status` report the resolved
  per-step map.

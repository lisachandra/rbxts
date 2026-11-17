---
"@lisachandra/sandcastle": patch
---

Run every agent phase through one phase module

Five places hand-assembled the same stack — clear the scoped marker, build the agent, run one attempt with
file logging that carries the session id, retry transient failures while resuming the captured session, then
refuse to call the attempt finished unless the marker exists: the three issue phases, the integration conflict
resolver, and the integration review. They now share `runPhase`.

The seam takes a _builder_ rather than an attempt object. `reloader.step("design")` and
`watchStep(reloader, "design")` must be evaluated inside the retry closure: a config reload aborts the
attempt, and the restart has to see the new selection with a watcher baselined on it. Reading them once would
freeze the model at the first attempt, which is the exact failure the reload path exists to prevent.

Two behaviour changes fall out of the shared contract:

- The conflict resolver and the integration review now return their `SandboxRunResult` instead of
  `Promise<void>`. Nothing in the orchestrator reads it — a resolver's success is its marker and the clean
  merge that follows — but discarding the result was what let those two sites drift from the issue phases in
  the first place.
- The issue phase table replaces three near-identical runners. Design's plan-handoff assertion and review's
  "no commits, nothing to review" gate are expressed as `after` and `shouldRun` on their rows, so the loop
  over phases carries no phase-specific branches.

The planner is deliberately not a caller: it runs with `Output.object`, which changes what the attempt
returns, so it is a different contract rather than a fifth instance of this one.

`--phase`, `--force`, `--resume`, prompt files and args, marker naming, and the `PhaseState` on-disk shape are
unchanged.

The published `evaluateDesign`, `evaluateImplement`, and `evaluateReview` keep their signatures and now
delegate to the one rule table. They are marked `@deprecated` in favour of `evaluatePhase` with an
explicit `PhaseEvaluationInput`, because the new form takes one input object and returns the decision
and its reason together instead of writing through a mutable `reasons` argument. Deprecating rather
than dropping them keeps this a patch: the refactor's goal was one implementation of each rule, not a
narrower public surface, and removing an export that reached consumers through `export * from
"./evaluate.js"` would be a breaking change that the refactor does not otherwise need.

---
"@lisachandra/sandcastle": patch
---

Resume a zcode session on the configured model instead of the session's original one
`session/resume` restores the selection persisted with the session and has no
`model` param (`sandcastle-zcode-resume-schema`), and its `thoughtLevel` param —
still forwarded until now — is never applied by the app-server's resume path.
So every resumed attempt silently continued on whatever model and reasoning
level created the session, no matter what the config asked for. With per-step
models, `agents.catalog` profiles, or a `queue run --parallel` lane hand-off,
that meant a phase could finish on a model nobody selected — a resumed retry of
an unimplemented design step would run on lane 0's model, and a model change
(`evaluateImplement` restarts implement when the model changes) could never take
effect across a resume.

- The wrapper now re-asserts the requested selection on a resumed session
  through the app-server's session-scoped mutators, after `session/subscribe`
  and before `session/send`, so the first turn already runs on it:
  `session/setModel` when the resumed `providerId/modelId` differs (it carries
  the reasoning level too), `session/setThoughtLevel` when only the effort
  differs. A matching selection sends nothing.
- Both mutators pass `persistAsWorkspaceLastUsed: false`, so a sandcastle run
  never rewrites the ZCode desktop app's last-used model for the workspace.
- The `thoughtLevel` key is dropped from the `session/resume` request: it was
  accepted by the schema but never applied, so it only suggested an effect it
  did not have.
- The stub app-server now models the real behavior — a resume returns the
  session's own persisted selection and ignores the requested effort, and
  `session/setModel`/`session/setThoughtLevel` mutate the live selection — so
  wrapper tests cover the mismatch, effort-only, already-matching, and
  nothing-requested paths.

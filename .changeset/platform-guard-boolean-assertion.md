---
"@lisachandra/platform": minor
---

feat(centurion): add `assertGuardsReturnBoolean` so an async guard cannot silently permit a command

Centurion evaluates a guard as `if not guard(context) then return nil end`, so only `false` and `nil`
deny. A guard that returns a `Promise` — the natural result of making authorization wait on a web call
— is truthy in that expression and the command runs. That is a silent authorization bypass, not a
rejected request, and nothing in Centurion or in this package catches it.

`@lisachandra/platform/centurion/testing` exports `assertGuardsReturnBoolean(cases, context)`, which
calls each guard and halts with a message naming the guard (and its command, when given) unless the
result is a boolean. `false` passes: denying a caller is a decision, not a defect.

Call it from a test with a fake context so an async guard fails the suite instead of shipping:

```ts
import { assertGuardsReturnBoolean } from "@lisachandra/platform/centurion/testing";

assertGuardsReturnBoolean(
	[{ command: "kick", guard: adminOrDeveloper, name: "adminOrDeveloper" }],
	context,
);
```

There is also an upstream ask to make Centurion reject a non-boolean guard return itself. Until that
lands, this is the seam.

# Triage Labels

Canonical workflow labels map directly to repo labels. Fetch them from `gh` (`pnpm issues:labels`).

Skill says role, use repo label.

`ready-for-agent` is the Sandcastle pickup gate (`pnpm sandcastle:issue`, queue: `pnpm
sandcastle queue list`). Apply only when the issue has enough context, acceptance criteria,
boundaries, validation expectations, and names the affected `@lisachandra/*` packages.

Do not mark broad roadmap/pass/milestone/design-discovery issues `ready-for-agent`. Keep as any other
label until split into narrow slices.

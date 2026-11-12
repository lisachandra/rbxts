---
"@lisachandra/platform": patch
---

Authorize admin commands on the exact role name, not a substring of it

`adminOrDeveloper` decided the role with `core/utils/string.includes`, which is a **substring**
test, against the default allowlist `["Developer", "Founder"]`. Any rank whose name merely contained
either word therefore authorized every admin command: `Developer Intern`, `Junior Developer`,
`Senior Game Developer`, `Ex-Developer`, `Founding Developer`, `Co-Founder`, `Developers`. Those
commands are `kick`, `set`, `teleport`, and `document`, so the bypass reached kicking any player and
rewriting persisted player documents.

- The decision is now a pure `authorize(input, policy)`, with `adminOrDeveloper` as the thin adapter
  that reads the executor and reports the denial. `createAuthorizationPolicy` folds the configured
  roles to lower case once, at configuration time, so a lookup is exact set membership.
- Matching is by full role name: `Developer` admits `developer` (case-folded) but never `Junior
  Developer`. An empty role — what `GetRoleInGroup` returns for a non-member — is denied.
- An empty configuration denies every player; an allowlisted user ID still bypasses the role check.
- The three `configure*` functions keep their signatures.

`test/platform` gains `guard.spec.ts` (29 cases) covering every near-miss rank, the exact matches,
denial reporting, and the unconfigured state. `CommandGuard` is typed `(context) => boolean`, so the
guard keeps the synchronous `GetRoleInGroup`; the stale-role window that leaves is filed separately
rather than silently dropped.

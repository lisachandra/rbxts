# Security controls: exact-role authorization for admin commands

## Summary

This design replaces the substring match inside the Centurion admin guard with exact, case-folded
membership of the configured role allowlist, and fixes the seam at which that decision is tested.

It is the first of three slices split out of #45 (the combined 2026-11-03 security and architecture
run). This spec covers **slice A only** — the admin guard. Slices B (item-mutation policy in
`@lisachandra/matter`) and C (a single child-process seam in `@lisachandra/sandcastle`) are not
specified here; they touch different packages and share no files with this work.

## Problem Statement

Every admin command in `@lisachandra/platform` is authenticated by exactly one function, and that
function admits the wrong players.

`adminOrDeveloper` (the guard attached to `kick`, `set`, `teleport`, and `document`) compares the
executor's group role against the configured allowlist using `includes` from
`@lisachandra/core/utils/string`. That helper answers "does this string appear anywhere inside that
string", not "are these two strings equal". The check therefore reads as an allowlist while behaving
as a fuzzy match.

With the default allowlist of `Developer` and `Founder`, every one of these roles is admitted:

- `Developer Intern`
- `Junior Developer`
- `Senior Game Developer`
- `Ex-Developer`
- `Founding Developer`
- `Co-Founder`

A player holding any of them can kick every player in the server, teleport entities, write arbitrary
values into item properties, and rewrite persisted player documents.

The defect is invisible in review, because the function is named for the policy it means to enforce
and the helper's name reads as a membership test. It is also invisible to the suite: `test/platform`
contains no guard spec at all, so a regression here produces no failing test.

## Solution

An allowlist that compares whole role names, and a spec that proves it.

After this change:

- A role is admitted only when its folded name is exactly one of the folded configured role names.
- `Developer` and `Founder` keep working. `Junior Developer` and its relatives stop working.
- An explicitly allowlisted user ID still bypasses the role check entirely, as today.
- A spec enumerates the near-miss ranks that must be refused, so the guard cannot silently return to
  fuzzy matching.

Operators see one behaviour change: a player who held admin only by virtue of a substring-matching
rank loses it. That is the fix.

## User Stories

1. As a game owner, I want the admin guard to admit only the roles I configured exactly, so that a
   member with any `…Developer` rank cannot kick players by accident or on purpose.
2. As a game owner, I want `Developer Intern`, `Junior Developer`, and `Ex-Developer` refused, so that
   membership of a role whose name merely contains an admin role conveys no admin power.
3. As a game owner, I want an explicitly allowlisted user ID to keep working regardless of group
   role, so that owners can grant admin without touching the group.
4. As a game owner, I want a non-member (empty role) refused, so that leaving the group removes
   admin.
5. As a game owner, I want an unconfigured guard to deny everyone, so that a missing configuration
   call fails closed rather than open.
6. As a game owner, I want role matching to be case-insensitive, so that a group renamed to
   `developer` does not lock every admin out.
7. As a game owner, I want a role whose name is longer than a configured role to be refused even when
   it shares a prefix, so that `Developers` is not confused with `Developer`.
8. As a maintainer, I want the comparison to be exact equality after case folding, so that the
   implementation matches what the word "allowlist" promises.
9. As a maintainer, I want the denial path to keep reporting the executor's name through the command
   context, so that operators can still see who was refused in the server log.
10. As a maintainer, I want the guard's public signature to stay `(context: CommandContext) => boolean`,
    so that Centurion's `CommandGuard` type and every existing `@Guard(adminOrDeveloper)` decoration
    keep compiling untouched.
11. As a maintainer, I want `configureCenturionUsers`, `configureCenturionRoles`, and
    `configureCenturionGroup` to keep their signatures, so that this security fix needs no consumer
    migration.
12. As a reviewer, I want a spec that fails against the current implementation, so that the fix is
    demonstrated rather than asserted.
13. As a reviewer, I want the spec to drive the same public guard the commands use, so that I am
    reading a test of the contract rather than of a helper only the tests call.
14. As a consumer of `@lisachandra/platform`, I want the behaviour change called out in the
    changeset, so that if I was relying on substring matching I learn about it before upgrading.
15. As a consumer, I want the guard to still be exported from the package root, so that commands in my
    own game can use the same check.
16. As an operator reading the log, I want a refused command to remain refused loudly, so that probing
    for admin is visible rather than silent.

## Implementation Decisions

### The comparison

Role admission becomes set membership of the case-folded role name, not substring containment.

- Both the configured role names and the observed role name are folded once, to lower case, before
  comparison. Folding is symmetric: a configured `Developer` matches an observed `developer` and vice
  versa.
- The comparison is whole-string equality after folding. `Developer Intern` folds to
  `developer intern`, which is not equal to `developer`, and is therefore refused.
- The configured roles are held for lookup in a structure that answers membership directly, rather
  than scanned with a generic string helper. This is the substance of the fix: the guard must use a
  membership primitive, and must not reach for `@lisachandra/core/utils/string`'s `includes`.
- Empty configuration denies. With no roles and no users configured, every executor is refused.
  This matches the current behaviour and is the safe reading of a missing `configureCenturionRoles`
  call.

### The guard's shape

The public guard keeps its exact current signature — a synchronous predicate over a Centurion
`CommandContext`. Two consequences follow, and both are decided here:

- **`GetRoleInGroupAsync` is not usable.** Centurion types a guard as a synchronous
  `(context) => boolean`. An async role lookup cannot be awaited inside a guard, and making the guard
  async would break the `CommandGuard` type, every `@Guard` decoration, and every consumer's
  commands. The synchronous `GetRoleInGroup` call stays.
- **Consequently, role staleness is accepted, not fixed.** The engine's own documentation notes that
  the synchronous lookup can be stale for a player who leaves a group mid-session, so a demotion can
  lag until the player rejoins. This is a pre-existing limitation, unchanged by this work. Fixing it
  requires either a Centurion change or a cached-role refresh keyed on a group-membership signal, and
  is explicitly out of scope here. The guard's TSDoc must state the limitation so the next reader does
  not assume the check is live.

The guard remains an adapter in two parts: it reads the executor's user ID and role off the context,
and it reports the denial through `context.error` including the executor's name. The decision itself
is a small internal helper — unexported, taking a user ID, an optional role, and the configured policy
— so the comparison is readable in isolation without widening the package's public surface.

### Why the decision is not extracted as a new public export

The question was raised whether to export a pure `authorize(...)` alongside the guard. It is decided
against: the guard already _is_ the seam, it is already exported from the package root, and it already
accepts an injectable `CommandContext` that the existing platform suite constructs as a plain mock
object. A second public function would be a second surface to keep in sync and a second thing
consumers could reach for, for no additional test coverage. The decision logic is extracted
_internally_ for readability; the tested contract is the guard.

This refines the phrasing in #46, which suggested exporting the decision. The behaviour it asked for
— a testable decision over (user ID, role, config) — is satisfied without a new export.

### Configuration

The three `configure*` functions keep their signatures and their global, last-write-wins semantics.
Their internals change from an `Array<string>`/`Array<number>` that is scanned, to structures that
answer membership directly. Reconfiguring replaces the previous configuration rather than adding to
it, as today.

This module-global state means the spec must reset configuration between cases; see the testing
decisions below.

### Failure direction

Unknown, empty, or absent role data is refused. A player whose `GetRoleInGroup` yields `""` (a
non-member) is refused. A guard configured with nothing is refused. There is no path where missing
data produces admission.

### Compatibility

This is a `patch` bump for `@lisachandra/platform`, not a `major`, because a guard that admits players
it was never configured to admit is a defect. Consumers who relied on substring matching were relying
on that defect, so the changeset must name the behaviour change explicitly rather than burying it with
routine fixes.

No signature changes, no new exports, no removals. `@lisachandra/core` is untouched: `includes` is
used correctly elsewhere in the repository and is not to be changed; this work simply stops using it
for authorization.

## Testing Decisions

### What makes a good test here

The test drives the **public guard** with a mock `CommandContext` and asserts only its boolean result
and whether it reported a denial. It must not reach into the configured state, must not call an
internal helper, and must not assert on how the comparison is performed. A future change from a `Set`
to any other membership structure must not break the spec; a change back to substring matching must.

### The seam

One seam, and it already exists: `adminOrDeveloper`, exported from the package root, invoked with a
`CommandContext` built as a plain object.

This is the highest available seam — it is the exact function every admin command is decorated with —
and it matches the existing pattern in the platform suite, which already builds a mock executor:

```
{ GetRoleInGroup: () => "Developer", Name: "…", UserId: … } as unknown as Player
```

No new seam is introduced. The internal decision helper is not exported and is not tested directly.

### What the spec covers

A table of role names against the default allowlist `["Developer", "Founder"]`:

- **Admitted:** `Developer`, `Founder`.
- **Refused, near misses:** `Developer Intern`, `Junior Developer`, `Senior Game Developer`,
  `Ex-Developer`, `Founding Developer`, `Co-Founder`, `Developers`, `Developers ` (trailing space),
  `Founder`-prefixed variants, and the empty string.
- **Case folding:** `developer` and `DEVELOPER` admitted, per the decision above.
- **User IDs:** an allowlisted user ID admitted even when the role is a near miss; a non-allowlisted
  user ID with an exact role admitted.
- **Unconfigured:** no roles and no users ⇒ refused.
- **Denial reporting:** the denial path calls the context's error reporter once, and the reported text
  names the executor.

One logical assertion per test, per the repository's testing standard.

### Prior art

`test/platform/src/documentCommand.spec.ts` already constructs a mock `CommandContext` and a mock
executor with `GetRoleInGroup`. The guard spec follows that shape rather than introducing a mocking
framework. Centurion's own `CommandContext` is constructed through `CenturionContext`, as that spec
does.

### Required evidence

The new spec must be run against the **unfixed** implementation first and must fail on the near-miss
cases. A spec that passes before and after proves nothing about the fix, so this pre-fix failure is
the primary evidence for the change and belongs in the pull request description.

## Out of Scope

- **Live role staleness.** Accepted and documented, per the decision above. Not fixed here.
- **A role hierarchy or permission levels.** Exact membership of a configured list is the whole
  contract; rank ordering, wildcards, and pattern matching are not part of it.
- **`SetCommand`'s property-value validation.** Writing arbitrary strings and numbers into item data
  is a separate concern, currently gated only by this guard. Filed separately if wanted.
- **Slices B and C of #45** — item-mutation bounds in `@lisachandra/matter`, and the child-process
  seam in `@lisachandra/sandcastle`.
- **Changing `@lisachandra/core/utils/string`'s `includes`.** It is correct for its other callers.
- **The command set, argument shapes, and the wording of the denial message.** Operators grep for the
  existing text.
- **Auditing other guards.** The repository has no other `CommandGuard` implementations today; if one
  appears, it is a new decision.

## Further Notes

### Why this slice is first

It is the smallest of the three and carries the largest blast radius: one function gates four commands
that can kick players, move entities, and rewrite persisted data. The other two slices are larger and
touch packages that share no files with this one, so they land independently.

### The defect class, not just the defect

The architecture review that ran alongside the security scan read this as the same underlying problem
in three places: **a security control implemented as a convention across call sites instead of as a
module with a testable interface.** Here the convention was "check the role with the string helper";
in `@lisachandra/matter` it is "clamp the amount where you remember to"; in `@lisachandra/sandcastle`
it is "quote the value where you interpolate it". Fixing the instance without naming the class is how
the next instance gets written. That is why each slice ends with a spec at the seam rather than only a
corrected line.

### Residual risk after this change

A group owner can still grant admin by renaming a role to exactly `Developer` or `Founder`. That is
configuration, not a vulnerability — the guard now admits precisely what it is told to admit.

The synchronous role lookup remains a latency-of-revocation gap, unchanged. Its practical impact is
bounded by server lifetime: a player who is demoted and then leaves and rejoins is re-evaluated.

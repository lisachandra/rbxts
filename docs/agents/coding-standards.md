# Coding Standards

## Public API Docs

Use TSDoc for public properties, functions, classes, modules.

- Document observable contract, not internals.
- Add examples for non-obvious APIs.
- Use tags when useful: `@param`, `@returns`, `@example`, `@remarks`, `@throws`, `@template`.

## Function Parameters

Optional params are bug magnets. Scrutinize. Prefer correctness over backwards compatibility.

Published packages make the blast radius wider than a game: a changed signature ships to every
consumer, so a renamed or tightened parameter is a breaking change (major bump, migration note in
the changeset) rather than a convenience.

## Constants

Grouped constants MUST use `@lisachandra/constant` `new Constant()`.

No plain object literals, top-level numeric/string exports, or other grouped constant patterns.

```ts
import { Constant } from "@lisachandra/constant";

const c = new Constant().add("INPUT_TICK_RATE", 120).add("DEBUG_LOG_INTERVAL", 0.5).build();
```

## Entity ID Spaces

For ECS (`@lisachandra/matter`), two ID spaces exist. Never mix without explicit mapping.

- `world.query` gives either client entity id or server entity id based on the current running context.
- `findClientEntityIdFromMap()` / `findServerEntityIdFromMap()` (`@lisachandra/matter/entity`) bridge
  the two ID spaces.
- Trace the ID from its origin to its use. Never assume a Matter id equals a server id, and never
  store a client id where a server id is expected.

## Testing

Tests verify behavior through public interfaces, not implementation details. Refactors should not
break tests unless behavior changed.

Good tests:

```typescript
import { describe, expect, it } from "@rbxts/jest-globals";

// GOOD: observable behavior through public interface
describe("createUser", () => {
	it("makes the user retrievable", () => {
		const user = createUser({ name: "Alice" });
		const retrieved = getUser(user.id);
		expect(retrieved.name).toBe("Alice");
	});
});
```

- Test caller/user behavior.
- Use public API only.
- Survive internal refactors.
- Prefer one logical assertion per test.

Bad tests:

```typescript
// BAD: mocks internal collaborator, tests HOW not WHAT
jest.mock(/* ... */ "./paymentService");
checkout(cart, payment);
expect(mockPaymentProcess).toHaveBeenCalledWith(cart.total);

// BAD: bypasses the interface to verify internal state
createUser({ name: "Alice" });
expect(internalRegistry.has("Alice")).toBe(true);
```

Red flags:

- Mocking internal collaborators.
- Testing private methods.
- Asserting internal call counts/order.
- Refactor breaks test with no behavior change.
- Test name says HOW, not WHAT.
- Verifying through external means instead of interface.

### Where Tests Live

- Package suites live in `test/<name>/` (`test/core`, `test/matter`, `test/ui`, ...) and import the
  package, never its `out/` build artifacts by path.
- `test/demo` is the integration showcase; treat it as a smoke test, not a unit suite.
- `packages/sandcastle` tests are plain `node:test` (`pnpm test:sandcastle`).

## Mocking

Mock system boundaries only:

- External APIs (Roblox web endpoints, Open Cloud).
- Time/randomness.
- File system or databases when a real instance is impractical.

Never mock own classes/modules or internal collaborators. If a module is hard to test, redesign the
interface — the seam belongs in the package, not in the test.

Prefer SDK-style boundary interfaces over generic fetchers. Each function independently mockable,
one return shape, no conditional test setup.

## TDD Vertical Slices

Do not write all tests first, then all implementation. That tests imagined behavior.

Use one test, one implementation, repeat.

```text
RED-GREEN: test1 then implementation1
RED-GREEN: test2 then implementation2
RED-GREEN: test3 then implementation3
```

Each test responds to prior learning. Never refactor while RED; get GREEN first.

## Interface Design

Prefer deep modules: small interface, deep implementation. Few methods, simple params, hidden
complexity.

Avoid shallow modules: large interface, many pass-through methods, thin implementation.

Ask:

- Can method count shrink?
- Can params simplify?
- Can more complexity hide inside?

Testability rules:

1. Accept dependencies; do not create them internally.
2. Return results; avoid side effects when possible.
3. Keep surface small; fewer methods and params mean simpler tests.

## Error Handling

Fail fast, fail loud. Prefer assertions over silent failure.

- Silent failures hide bugs.
- Assertions surface problems immediately.
- Better to crash in development than fail silently in production.

### Assertions vs Guard Clauses

Prefer assertions over guard clauses. Guard clauses that silently return hide bugs.

```ts
// BAD: guard clause hides the bug
function damageEntity(world: World, entity: Entity, amount: number): void {
	const health = world.get(entity, HealthComponent);
	if (!health) {
		// Silent failure - why is health missing?
		return;
	}

	world.set(entity, HealthComponent, health - amount);
}

// GOOD: assertion surfaces the bug
function damageEntity(world: World, entity: Entity, amount: number): void {
	const health = world.get(entity, HealthComponent);
	assert(health, "Cannot damage entity without HealthComponent");
	world.set(entity, HealthComponent, health - amount);
}
```

Use guard clauses only when:

- The undefined/null case is legitimately expected (optional data).
- You have explicit handling logic for that case.
- The caller expects and handles the fallback value.

If you cannot explain why the value might be undefined, use an assertion.

### Assertions vs Errors

Choose by failure category.

`assert()` for programmer errors — conditions that should never happen if code is correct:

- Missing expected component on entity.
- Invalid internal state transitions.
- Design contract violations.

Assertions also document intent:

```ts
const health = world.get(entity, HealthComponent);
assert(health !== undefined, "Entity missing required HealthComponent");
// Entities ALWAYS have health at this point
```

`Log.Fatal` (see [Logging](#logging)) for runtime failures that must stop control flow —
external/unpredictable input, and nothing an outer handler can recover from:

- Missing or malformed asset.
- Network payload that violates its contract.
- External data corruption.
- Player-provided data that fails validation.

Keep `throw` (from `@rbxts/luau-polyfill` for non-Error values) when an outer handler exists and must
catch, add context, or convert the failure into a `Result`.

### Logging

`@rbxts/log` is the only logging surface: `import Log from "@rbxts/log"`. Never call `print`,
`warn`, or `error` outside the core sink (`packages/core/src/logger.ts`, which carries an
`oxlint-disable` with a reason), and never wrap `Log.*` in `pcall` — the sink owns the
level-to-`LogService` mapping.

| Level                       | Use for                                      | Halts? |
| --------------------------- | -------------------------------------------- | ------ |
| `Log.Verbose` / `Log.Debug` | noisy per-step diagnostics                   | no     |
| `Log.Info`                  | lifecycle events worth reading in production | no     |
| `Log.Warn`                  | recoverable or degraded behaviour            | no     |
| `Log.Fatal`                 | failures that must stop control flow         | yes    |

- `Log.Fatal` is the halting level and is typed `never` (see `patches/README.md`), so delete
  unreachable code after it instead of adding `return`/`break` statements.
- `Log.Error` is a non-halting record — never use it where control flow must stop. Same for bare
  `error()`.
- Enforced by the `project/logging` block in `oxlint.config.ts` (test files are exempt).

### Type Guards vs Data Validation

Flamework type guards validate types, not data integrity.

```ts
// Type guard guarantees petName is string.
// Exploiters can still send malformed UTF-8, NaN, or oversized strings.
events.connect((player, petName) => {
	// Flamework handled: petName is string
	// Still need to validate data:
	if (!utf8.len(petName)) {
		Log.Fatal("Invalid UTF-8 string"); // Prevents DataStore exploit
	}
});
```

Type safety ≠ data safety. Type guards catch `string` vs `number`, not malformed UTF-8, NaN, or size
limits that break DataStores.

### Defense-in-Depth

Validate at every layer data passes through. Make bugs structurally impossible.

| Layer       | Purpose                               | Example                       |
| ----------- | ------------------------------------- | ----------------------------- |
| Entry       | Reject invalid input at API boundary  | UTF-8 validation, size limits |
| Business    | Ensure data makes sense for operation | Ownership checks, existence   |
| Environment | Prevent dangerous context operations  | No client DataStore writes    |
| Debug       | Capture context for forensics         | Stack traces, data logging    |

Single validation: "we fixed the bug." Multiple layers: "we made the bug impossible."

### Result Pattern

For operations that can legitimately fail:

```ts
type Result<T, E = string> = { error: E; success: false } | { success: true; value: T };
```

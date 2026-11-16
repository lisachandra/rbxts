# @lisachandra/test

Test helpers for Jest Roblox, aimed at the one thing that is genuinely awkward to test: modules that
`require` their dependencies at load time.

## Mocking a module

A roblox-ts module is a table returned from `require`, so `jest.spyOn` cannot reach inside it, and there
is no way to substitute it after the importer has run. `TestRuntimeUtils` gets around that with a
metatable proxy.

```ts
import { jest } from "@rbxts/jest-globals";
import { TestRuntimeUtils } from "@lisachandra/test";

const instance = TestRuntimeUtils.createMockInstance(myService); // reads pass through
const mock = TestRuntimeUtils.mockOnRuntime(jest, instance); // functions become jest.fn()

mock.__mockValue__ = (self, key, value) => {
	if (key === "getData") {
		return $tuple(true, jest.fn().mockReturnValue("stubbed"));
	}
	return $tuple(false, nil); // fall through to the real value
};

afterEach(() => {
	TestRuntimeUtils.restoreAllMocks();
});
```

`createMockInstance` rebinds `self` to the original object by default, so methods that touch internal
state keep working. Pass `false`, or a per-key record, when a method must see the proxy instead.

`mockOnRuntime` resolves keys lazily and caches them, so only the members a test actually touches are
wrapped. `resetTSRuntime(clean)` clears the roblox-ts module cache between suites; `clean` also destroys
everything in `Workspace` except `Terrain` and `Camera`, which is the fastest way to get a blank slate.

## React tests

`describeEachReactMode` runs a suite twice — normally and under `StrictMode` — which catches effects that
only misbehave on a double render:

```tsx
import { describeEachReactMode } from "@lisachandra/test";
import { expect, it } from "@rbxts/jest-globals";

describeEachReactMode("Counter", ({ render, suiteKey }) => {
	it(`starts at zero (${suiteKey})`, () => {
		const { getByText } = render(<Counter />);
		expect(getByText("0")).toBeDefined();
	});
});
```

The `render` it hands you already applies the wrapper, so components do not need to know which mode they
are in.

`createMockInputObject(partial)` builds a complete `InputObject` with sensible defaults, so a test only
specifies the fields it cares about. `fireClickEvent(button)` fires an `Activated` through
`@rbxts/react-roblox-fire`, handling the input object for you.

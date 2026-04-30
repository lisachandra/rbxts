---
name: Global Mocks
description: |
    Mocking global Luau functions like print() and math.random() using
    jest.globalEnv, plus Godkin-specific patterns for mocking services and
    modules with mockOnRuntime.
---

# Global Mocks

## Import

```ts
import { beforeAll, expect, it, jest } from "@rbxts/jest-globals";
import { createMockInstance, getModuleByTree, mockOnRuntime, resetTSRuntime } from "test/utils";
```

## Mocking Global Functions

Use `jest.spyOn()` with `jest.globalEnv` to mock globals like `print()`:

```ts
it("should capture print output", () => {
	expect.assertions(1);

	const mockPrint = jest.spyOn(jest.globalEnv, "print");
	mockPrint.mockImplementation(() => {
		/* no-op */
	});

	print("hello");

	expect(mockPrint).toHaveBeenCalledWith("hello");
});
```

## Mocking Library Functions

Index into `jest.globalEnv` to access libraries like `math`:

```ts
it("should mock math.random", () => {
	expect.assertions(1);

	const mockRandom = jest.spyOn(jest.globalEnv.math, "random");
	mockRandom.mockReturnValue(5);

	expect(math.random(1, 6)).toBe(5);
});
```

## Accessing Original Implementations

The original (unmocked) functions are available on `jest.globalEnv`:

```ts
const mockRandom = jest.spyOn(jest.globalEnv.math, "random");
mockRandom.mockReturnValue(5);

math.random(); // 5 (mocked)
jest.globalEnv.math.random(); // actual random number (original)
```

## Godkin Pattern: Mocking Services

**MANDATORY for all test files that use Roblox services.** Use `mockOnRuntime` with `createMockInstance`:

```ts
const servicesModule = getModuleByTree(...$getModuleTree("@rbxts/services"));
const tsRuntimeModule = getModuleByTree(...$getModuleTree("include/RuntimeLib"));

const tsRuntime = require(tsRuntimeModule) as typeof import("include/RuntimeLib");

describe("MyTest", () => {
	let mockServices: ReturnType<typeof mockOnRuntime<typeof import("@rbxts/services"), true>>;

	beforeAll(() => {
		// MANDATORY: Mock RuntimeLib first
		jest.mock<typeof import("include/RuntimeLib")>(tsRuntimeModule, () => tsRuntime);

		// Mock services with withMethods = true
		jest.mock<typeof import("@rbxts/services")>(servicesModule, () => {
			const original: typeof import("@rbxts/services") = jest.requireActual(servicesModule);
			mockServices = mockOnRuntime(jest, createMockInstance(original, true), true);
			// Preserve UI assets that can't be mocked
			mockServices.ReplicatedStorage.UI = original.ReplicatedStorage.UI as never;
			return mockServices;
		});

		// Require to initialize mocked variables
		require(servicesModule);
	});

	beforeEach(() => {
		resetTSRuntime();
		jest.clearAllMocks();
	});

	it("should use mocked RunService", () => {
		mockServices.RunService.IsStudio.mockReturnValue(true);
		// ... test code ...
	});
});
```

### Mock Types: `withMethods` Parameter

| Value | Type Used | Use Case |
|-------|-----------|----------|
| `true` (default) | `MockOnRuntime<T>` | Objects with methods (services, World) |
| `false` | `MockOnRuntimeWithoutMethods<T>` | Simple objects/hooks without methods |

```ts
// With methods - for services, World, etc.
let mockServices: ReturnType<typeof mockOnRuntime<typeof import("@rbxts/services"), true>>;
mockServices = mockOnRuntime(jest, createMockInstance(original, true), true);

// Without methods - for simple hooks/modules
let mockEventQueue: ReturnType<typeof mockOnRuntime<typeof import("client/ui/hooks/useEventQueue"), false>>;
mockEventQueue = mockOnRuntime(jest, createMockInstance(original, false), false);
```

## Godkin Pattern: Mocking Store

```ts
const storeModule = getModuleByTree(...$getModuleTree("shared/store"));

describe("MyTest", () => {
	let mockStore: typeof import("shared/store").default;
	let mockWorld: ReturnType<typeof mockOnRuntime<World, true>>;

	beforeAll(() => {
		jest.mock<typeof import("shared/store")>(storeModule, () => {
			const original: typeof import("shared/store") = jest.requireActual(storeModule);
			mockStore = { ...original.default } as never;
			return { ...original, default: mockStore };
		});
	});

	beforeEach(() => {
		mockWorld = mockOnRuntime(jest, createMockInstance(new World()), true);
		mockStore.world = mockWorld as never as World;
	});
});
```

## Limitations

Jest Roblox only supports mocking **whitelisted** globals. These are **not**
supported:

- `game:GetService()` and Instance methods — use `mockOnRuntime` pattern above as a workaround
  or `jest.spyOn(game, "GetService")` with `mockDataModel` enabled instead
- `require()` — use `jest.mock()` instead
- Task scheduling (`task.delay`, etc.) — use `jest.useFakeTimers()` instead

Attempting to mock a non-whitelisted global produces an error:

```text
Jest does not yet support mocking the require global.
```

<!--
Source references:
- https://github.com/Roblox/jest-roblox/blob/main/docs/docs/GlobalMocks.md
- https://github.com/Roblox/jest-roblox/blob/main/docs/docs/JestObjectAPI.md
-->

# @lisachandra/test

Test utilities and runtime helpers for Jest Roblox (`@rbxts/jest`).

## Install

```bash
pnpm add @lisachandra/test
```

Peer dependencies: `@lisachandra/types`, `@rbxts/jest`, `@rbxts/jest-globals`, `@rbxts/luau-polyfill`, `@rbxts/services`, `@rbxts/types`, `type-fest`

---

## TestRuntimeUtils

A runtime-aware testing bridge that enables flexible mocking patterns in Luau test environments.

```ts
import { TestRuntimeUtils } from "@lisachandra/test";
import { jest } from "@rbxts/jest-globals";

// Create a mock wrapper around a real object
const mock = TestRuntimeUtils.createMockInstance(myService);
// mock.someMethod() → calls through to the original

// Promote to full runtime mock with jest-backed functions
const runtimeMock = TestRuntimeUtils.mockOnRuntime(jest, mock);
// runtimeMock.someMethod is now jest.fn()

// Override specific keys
runtimeMock.__mockValue__ = (self, key, value) => {
  if (key === "getData") {
    return $tuple(true, jest.fn().mockReturnValue("stubbed"));
  }
  return $tuple(false, nil);
};

// After each test:
TestRuntimeUtils.restoreAllMocks();
```

### API

| Method | Description |
|---|---|
| `createMockInstance(instance, mockSelf?)` | Create a metatable proxy that wraps an object — property reads pass through, methods are optionally rebound to the original |
| `mockOnRuntime(jestModule, mockInstance)` | Promote a MockInstance to a full runtime mock — function properties become `jest.fn()`, nested objects are recursively wrapped |
| `restoreAllMocks()` | Restore all `jest.fn()` mocks to their original implementations |
| `resetTSRuntime(clean?)` | Reset the roblox-ts runtime. If `clean=true`, destroys all Workspace children (except Terrain and Camera) |
| `getModuleByTree(root, parts)` | Traverse an Instance hierarchy via `WaitForChild` to find a `ModuleScript` |
| `isTesting` | `boolean` — whether currently executing inside Jest |

### Types

| Type | Description |
|---|---|
| `MockInstance<T>` | Mock wrapper with `__instance__` and `__mockSelf__` |
| `MockOnRuntime<T>` | Fully-instrumented runtime mock with `__mockValue__` hook |
| `MockedObjectWithMethodsDeep<T>` | Recursive type transforming all functions into MockMethods |
| `MockInstanceDeep<T, Original>` | Deep recursive mock wrapper type |

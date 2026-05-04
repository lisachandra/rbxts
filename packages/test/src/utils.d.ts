/**
 * **@lisachandra/test — TestRuntimeUtils**
 *
 * Runtime-aware testing bridge that enables flexible mocking patterns in
 * Luau test environments. Wraps roblox-ts compiled modules with
 * metatable-based proxies so methods on a mock instance automatically
 * rebind `this` to the original object, while still allowing test authors
 * to override behavior via `jest.fn()`-backed mocks.
 *
 * @example
 * ```ts
 * import { TestRuntimeUtils } from "@lisachandra/test";
 * import { jest } from "@rbxts/jest-globals";
 *
 * // Create a mock wrapper around a real object
 * const mock = TestRuntimeUtils.createMockInstance({ value: 10 });
 * // mock.value → 10  (reads through to the instance)
 *
 * // Convert to a full runtime mock with jest-backed methods
 * const runtimeMock = TestRuntimeUtils.mockOnRuntime(jest, mock);
 * // Any function properties are now jest.fn() instances
 * ```
 */

import type { jest } from "@rbxts/jest-globals";

/**
 * Represents a mock wrapper around an original object instance.
 * Provides transparent property access via Luau metatables while
 * tracking which methods should rebind `self` to the original
 * instance when called through the mock.
 *
 * @template T - The type of the wrapped object.
 */
export interface MockInstance<T extends object> {
	/** The original object being wrapped. */
	__instance__: T;
	/**
	 * Controls whether methods accessed through the mock are rebound
	 * so that `self` refers to `__instance__` rather than the mock
	 * proxy. The Luau implementation wraps the method as
	 * `function(_, ...) return method(source, ...) end`.
	 * - `true` — all methods are rebound.
	 * - `Record<keyof T, boolean>` — selectively enable per-key.
	 */
	__mockSelf__: boolean | Record<keyof T, boolean>;
}

/**
 * Signature for a mocked method produced by the runtime mock proxy.
 * The `this` context is void (the callable is a free function),
 * `object` receives the original instance, and the remaining args
 * and return type are forwarded from the original method.
 *
 * @template T - The original method type.
 */
type MockMethod<T> = (
	this: void,
	object: InferThis<T>,
	...args: Parameters<OmitThisParameter<T>>
) => ReturnType<T>;

/**
 * Recursively transforms a type so that every function-valued
 * property becomes a {@link MockMethod}, while non-function values
 * and nested objects are left as-is (with nested objects further
 * recursed).
 *
 * @template T - The object type to transform.
 */
type MockedObjectWithMethodsDeep<T extends object> = {
	[K in keyof T]: InferThis<T[K]> extends never
		? T[K] extends object
			? MockedObjectWithMethodsDeep<T[K]>
			: T[K]
		: MockMethod<T[K]>;
};

/**
 * Combines a {@link MockInstance} wrapper with Jest's deep mock
 * infrastructure so every nested property is recursively mocked.
 * Object-typed properties are themselves wrapped via
 * {@link TestRuntimeUtils.createMockInstance}.
 *
 * @template T - The mocked object type (typically
 *   `jest.MockedObjectDeep<...>`).
 * @template Original - The original, unwrapped object type.
 */
type MockInstanceDeep<T extends object, Original extends object> = MockInstance<Original> & {
	[K in keyof T]: T[K] extends object
		? ReturnType<typeof TestRuntimeUtils.createMockInstance<T[K]>> & T[K]
		: T[K];
};

/**
 * The fully-instrumented runtime mock type. Merges:
 *
 * 1. {@link MockInstanceDeep} — deep recursive mock wrappers.
 * 2. `jest.MockedObjectDeep<MockedObjectWithMethodsDeep<T>>` — Jest
 *    mock tracking for every function property.
 * 3. `__mockValue__` — a hook that lets test authors intercept
 *    property access and supply a custom mock value, bypassing the
 *    default auto-mocking logic.
 *
 * @remarks
 * When a property is accessed for the first time, the proxy calls
 * `__mockValue__(self, key, currentValue)`. If it returns
 * `useMocked == true`, the returned `mockedValue` is used directly.
 * Otherwise, the default auto-mocking logic runs:
 * - Functions are wrapped in `jest.fn(currentValue)`.
 * - Plain tables and userdata are recursively wrapped via
 *   `mockOnRuntime(jest, createMockInstance(value))`.
 * - All other values pass through unchanged.
 * - The result is cached on the proxy so subsequent accesses are
 *   direct property reads.
 *
 * @template T - The original object type being mocked.
 *
 * @example
 * ```ts
 * declare function getMock(obj: object): MockOnRuntime<typeof obj>;
 *
 * const mock = getMock(myService);
 * // Override the hook to supply a custom mock for a specific key
 * mock.__mockValue__ = (self, key, value) => {
 *   if (key === "fetchData") {
 *     return $tuple(true, jest.fn().mockReturnValue("cached"));
 *   }
 *   return $tuple(false, nil);
 * };
 * ```
 */
type MockOnRuntime<T extends object> = MockInstanceDeep<
	jest.MockedObjectDeep<MockedObjectWithMethodsDeep<T>>,
	T
> & {
	/**
	 * Intercepts property access on the mock proxy. Called
	 * automatically by the Luau `__index` metamethod with
	 * `(self, key, currentValue)`.
	 *
	 * - Return `true, replacementValue` to bypass auto-mocking
	 *   and use `replacementValue` directly.
	 * - Return `false, nil` (the default) to run the standard
	 *   auto-mocking logic.
	 *
	 * @param this - The MockOnRuntime instance.
	 * @param key - The property key being accessed.
	 * @param value - The current value from the original instance.
	 * @returns A tuple `(useMocked, mockedValue)`.
	 */
	__mockValue__: <K extends keyof MockOnRuntime<T>>(
		this: MockOnRuntime<T>,
		key: K,
		value: MockOnRuntime<T>[K],
	) => any;
};

/**
 * Provides utility functions for runtime-aware testing helpers.
 *
 * @example
 * ```ts
 * // Standard pattern: create a mock instance, then promote it
 * import { jest } from "@rbxts/jest-globals";
 * import { TestRuntimeUtils } from "@lisachandra/test";
 *
 * const instance = TestRuntimeUtils.createMockInstance(myService);
 * const mock = TestRuntimeUtils.mockOnRuntime(jest, instance);
 *
 * // Use mock in tests, override behavior as needed
 * mock.__mockValue__ = (self, key, value) => {
 *   if (key === "getData") {
 *     return $tuple(true, jest.fn().mockReturnValue("stub"));
 *   }
 *   return $tuple(false, nil);
 * };
 *
 * // After each test:
 * TestRuntimeUtils.restoreAllMocks();
 * ```
 */
declare const TestRuntimeUtils: {
	/**
	 * Creates a mock wrapper around an instance. Property reads pass
	 * through to the original object; function properties are
	 * optionally rebound so `self` refers to `__instance__` rather
	 * than the mock proxy.
	 *
	 * @param instance - The original object to wrap.
	 * @param mockSelf - Whether to rebind methods' `self` to the
	 *   instance. Defaults to `true`. Pass a `Record<keyof T,
	 *   boolean>` to selectively control which keys are rebound.
	 * @returns A `MockInstance<T>` merged with a writable partial
	 *   of `T`, allowing tests to set or override any property.
	 *
	 * @example
	 * ```ts
	 * const svc = { getValue: () => 42, name: "example" };
	 * const mock = TestRuntimeUtils.createMockInstance(svc);
	 * // mock.getValue()  → 42 (self === svc)
	 * // mock.name        → "example"
	 * mock.name = "overridden";
	 * // mock.name        → "overridden"
	 * ```
	 *
	 * @example
	 * ```ts
	 * // Disable self-rebinding for all methods
	 * const noRebind = TestRuntimeUtils.createMockInstance(svc, false);
	 * // noRebind.getValue()  → 42 (self === noRebind)
	 *
	 * // Selectively enable self-rebinding
	 * const selective = TestRuntimeUtils.createMockInstance(svc, {
	 *   getValue: true,
	 * });
	 * ```
	 */
	createMockInstance: <T extends object>(
		instance: T,
		mockSelf?: boolean | Record<keyof T, boolean>,
	) => MockInstance<T> & Writable<Partial<T>>;

	/**
	 * Traverses a Roblox Instance hierarchy to find a `ModuleScript`
	 * by successive `WaitForChild` calls. Useful for locating
	 * compiled modules inside nested container folders during tests.
	 *
	 * @param root - The starting `Instance` (e.g. `script.Parent`).
	 * @param parts - Ordered array of child names to traverse
	 *   (passed to `Instance:WaitForChild`).
	 * @returns The `Instance` at the end of the hierarchy. While
	 *   the type declares `ModuleScript`, the Luau implementation
	 *   returns the raw result of the final `WaitForChild` call.
	 *
	 * @example
	 * ```ts
	 * // Find container.SubFolder.MyModule
	 * const mod = TestRuntimeUtils.getModuleByTree(container, [
	 *   "SubFolder",
	 *   "MyModule",
	 * ]);
	 * ```
	 */
	getModuleByTree: (root: Instance, parts: Array<string>) => ModuleScript;

	/**
	 * Whether the current execution is inside a Jest test runner.
	 * Set to `_G.__TEST__` by the setup script.
	 *
	 * @example
	 * ```ts
	 * if (TestRuntimeUtils.isTesting) {
	 *   // skip side-effect-heavy initialization
	 * }
	 * ```
	 */
	isTesting: boolean;

	/**
	 * Promotes a {@link MockInstance} to a fully-instrumented
	 * `MockOnRuntime`. Function properties accessed through the
	 * returned proxy are automatically wrapped with `jest.fn()`,
	 * and a `__mockValue__` hook is added for per-key overrides.
	 *
	 * Nested tables and userdata are recursively wrapped. Values
	 * are cached on the proxy so each key is only resolved once.
	 *
	 * @param jestModule - The `jest` namespace (from
	 *   `@rbxts/jest-globals`).
	 * @param mockInstance - A previously-created `MockInstance`.
	 * @returns A `MockOnRuntime<T>` with lazy mock installation and
	 *   `__mockValue__` support.
	 *
	 * @example
	 * ```ts
	 * import { jest } from "@rbxts/jest-globals";
	 *
	 * const inst = TestRuntimeUtils.createMockInstance(myService);
	 * const mock = TestRuntimeUtils.mockOnRuntime(jest, inst);
	 *
	 * // First access to a function key wraps it in jest.fn()
	 * const fn = mock.someMethod;
	 * // fn is now a jest.Mock backed by the original implementation
	 *
	 * // Override a specific key via the hook
	 * mock.__mockValue__ = (self, key, value) => {
	 *   if (key === "someMethod") {
	 *     return $tuple(true, jest.fn().mockReturnValue("stubbed"));
	 *   }
	 *   return $tuple(false, nil);
	 * };
	 * ```
	 */
	mockOnRuntime: <T extends object>(
		jestModule: typeof jest,
		mockInstance: MockInstance<T> & Writable<Partial<T>>,
	) => MockOnRuntime<T>;

	/**
	 * Finds and resets the active roblox-ts `RuntimeLib`. Iterates
	 * all `_G` entries, clears any keyed by `ModuleScript`, and
	 * calls `RuntimeLib.reset()` on the first runtime found.
	 *
	 * @param clean - If `true`, additionally destroys all children
	 *   of `Workspace` except `Terrain` and `Camera`. Useful for
	 *   cleaning up spawned instances between test suites.
	 * @returns The resolved `RuntimeLib` instance, or `nil` if
	 *   none was found.
	 *
	 * @example
	 * ```ts
	 * // Soft reset (clear module state only)
	 * TestRuntimeUtils.resetTSRuntime();
	 *
	 * // Hard reset (also clear workspace leftovers)
	 * TestRuntimeUtils.resetTSRuntime(true);
	 * ```
	 */
	resetTSRuntime: (clean?: boolean) => N<RuntimeLib>;

	/**
	 * Restores all `jest.fn()` mocks created by `mockOnRuntime` back
	 * to their original implementations. For each mock, calls
	 * `mockRestore()` followed by `mockImplementation(original)`.
	 *
	 * Call this in `afterEach` or between test cases to prevent
	 * cross-test contamination.
	 *
	 * @example
	 * ```ts
	 * afterEach(() => {
	 *   TestRuntimeUtils.restoreAllMocks();
	 * });
	 * ```
	 */
	restoreAllMocks: () => void;
};

export = TestRuntimeUtils;

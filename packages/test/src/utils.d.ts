/* eslint
	ts/no-explicit-any: "off",
	ts/naming-convention: [
		"error",
		{
			selector: "default",
			format: ["camelCase", "PascalCase"],
			leadingUnderscore: "allowSingleOrDouble",
			trailingUnderscore: "allowSingleOrDouble"
		}
	]
-- TestRuntimeUtils declaration file --
*/

import type { jest } from "@rbxts/jest-globals";

export interface MockInstance<T extends object> {
	__instance__: T;
	__mockSelf__: boolean | Record<keyof T, boolean>;
}

type MockMethod<T> = (
	this: void,
	object: InferThis<T>,
	...args: Parameters<OmitThisParameter<T>>
) => ReturnType<T>;

type MockedObjectWithMethodsDeep<T extends object> = {
	[K in keyof T]: InferThis<T[K]> extends never
		? T[K] extends object
			? MockedObjectWithMethodsDeep<T[K]>
			: T[K]
		: MockMethod<T[K]>;
};

type MockInstanceDeep<T extends object, Original extends object> = MockInstance<Original> & {
	[K in keyof T]: T[K] extends object
		? ReturnType<typeof TestRuntimeUtils.createMockInstance<T[K]>> & T[K]
		: T[K];
};

type MockOnRuntime<T extends object> = MockInstanceDeep<
	jest.MockedObjectDeep<MockedObjectWithMethodsDeep<T>>,
	T
> & {
	__mockValue__: <K extends keyof MockOnRuntime<T>>(
		this: MockOnRuntime<T>,
		key: K,
		value: MockOnRuntime<T>[K],
	) => any;
};

/** Provides utility functions for runtime-aware testing helpers. */
declare const TestRuntimeUtils: {
	createMockInstance: <T extends object>(
		instance: T,
		mockSelf?: boolean | Record<keyof T, boolean>,
	) => MockInstance<T> & Writable<Partial<T>>;

	getModuleByTree: (root: Instance, parts: Array<string>) => ModuleScript;

	isTesting: boolean;

	mockOnRuntime: <T extends object>(
		jestModule: typeof jest,
		mockInstance: MockInstance<T> & Writable<Partial<T>>,
	) => MockOnRuntime<T>;

	resetTSRuntime: (clean?: boolean) => N<RuntimeLib>;

	restoreAllMocks: () => void;
};

export = TestRuntimeUtils;

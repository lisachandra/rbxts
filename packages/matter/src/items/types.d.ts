/*
 * This module defines utility types for working with item data. It includes
 * types for validating PascalCase paths, extracting data, and excluding
 * PascalCase properties.
 */

import { Component } from "@rbxts/matter";
import { ValidItemPath } from "./definitions";

/**
 * A Matter {@link Component} holding an array of {@link Item} objects.
 */
export type ItemContainer = Component<{ items: Array<Item> }>;

/**
 * Extracts all valid item paths that start with the given prefix `P`.
 *
 * @typeParam P - A valid item path prefix.
 *
 * @example
 * ```ts
 * type SwordPaths = ExtractItemWithId<["Weapon", "Sword"]>;
 * // Includes ["Weapon", "Sword"] and any deeper paths
 * ```
 */
export type ExtractItemWithId<P extends ValidItemPath> = Extract<
	ValidItemPath,
	[...P, ...Array<string>]
>;
/**
 * Extracts child item paths from a parent path, optionally excluding the
 * parent itself.
 *
 * @typeParam P - A valid item path.
 * @typeParam ExcludeParent - If `true`, excludes the parent path `P` from
 *   the resulting union.
 */
export type ItemHierarchyIds<
	P extends ValidItemPath,
	ExcludeParent extends N<boolean>,
> = ExcludeParent extends true ? Exclude<ExtractItemWithId<P>, P> : ExtractItemWithId<P>;

/**
 * Recursively constructs a union of all valid PascalCase key paths through
 * an object type `T`.
 *
 * @typeParam T - The object type to extract paths from.
 *
 * @example
 * ```ts
 * type Paths = ValidPascalCasePath<typeof itemDefinitions>;
 * // ["Weapon"] | ["Weapon", "Sword"] | ["Consumable"] | ...
 * ```
 */
export type ValidPascalCasePath<T> = T extends object
	? {
			[K in PascalCaseKeys<T>]: [K] | [K, ...ValidPascalCasePath<T[K]>];
		}[PascalCaseKeys<T>]
	: [];

/**
 * Evaluates to `true` if `S` starts with an uppercase letter, indicating
 * PascalCase.
 *
 * @typeParam S - The string to check.
 */
export type IsPascalCase<S extends string> = S extends `${infer F}${infer _R}`
	? F extends Uppercase<F>
		? true
		: false
	: false;

/**
 * Extracts the keys of `T` that are PascalCase (start with an uppercase
 * letter).
 *
 * @typeParam T - The object type to filter keys from.
 */
export type PascalCaseKeys<T> = {
	[K in keyof T]: K extends string ? (IsPascalCase<K> extends true ? K : never) : never;
}[keyof T];

/**
 * Recursively extracts the data type at a given path within an item
 * definitions tree.
 *
 * @typeParam T - The object type to traverse.
 * @typeParam Path - A tuple of keys representing the path.
 * @typeParam U - If `true`, returns only the leaf data without merging
 *   ancestors.
 */
export type ExtractData<T, Path extends Array<string>, U extends boolean = false> = Path extends [
	infer Head,
	...infer Tail,
]
	? Head extends keyof T
		? Tail extends Array<string>
			? U extends true
				? ExtractData<T[Head], Tail, U>
				: ExtractData<T[Head], Tail, U> & T[Head]
			: T[Head]
		: Record<string, unknown>
	: T extends object
		? T
		: Record<string, unknown>;

/**
 * Omits all PascalCase keys from `T`, leaving only the non-PascalCase (data)
 * properties.
 *
 * @typeParam T - The object type to filter.
 */
export type ExcludePascalCaseProperties<T extends object> = Omit<T, PascalCaseKeys<T>>;

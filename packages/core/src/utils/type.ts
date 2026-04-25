/* eslint-disable ts/no-unnecessary-type-parameters -- Type utility */
import type { Modding } from "@flamework/core";
import { Symbol } from "@rbxts/luau-polyfill";

import type { Entries, Includes, Words } from "type-fest";

/* eslint-disable ts/naming-convention -- Type aliases */

export type Mapify<T> = T extends Array<[infer K, infer V]> ? Map<K, V> : never;

export type EventLike<T extends Callback = Callback> =
	| { Connect(callback: T): ConnectionLike }
	| { connect(callback: T): ConnectionLike }
	| { subscribe(callback: T): ConnectionLike };

export type ConnectionLike = (() => void) | { Disconnect(): void } | { disconnect(): void };

export type FilterStringsByWord<T extends string, U extends string> = T extends infer S
	? S extends string
		? Includes<Words<S>, U> extends true
			? S
			: never
		: never
	: never;

export type CaseInsensitiveMatch<A extends string, B extends string> =
	Lowercase<A> extends Lowercase<B> ? true : false;

export type LookupKeyIgnoreCase<A extends object, B extends string> = {
	[K in keyof A]: K extends string
		? CaseInsensitiveMatch<K, B> extends true
			? K
			: never
		: never;
}[keyof A];

export type KeyValueString<T, S extends string> = T extends string
	? T
	: {
			[K in keyof T]: K extends string
				? T[K] extends infer V
					? V extends object
						? `${K}${S}${KeyValueString<V, S>}`
						: V extends string
							? string extends V
								? never
								: `${K}.${V}`
							: never
					: never
				: never;
		}[keyof T];

export type StringIncludes<S extends string, Sub extends string> = S extends `${any}${Sub}${any}`
	? true
	: false; // type-coverage:ignore-line

export type PredicateType<
	T extends (
		value: any, // type-coverage:ignore-line
	) => value is any, // type-coverage:ignore-line
> = T extends (
	value: any, // type-coverage:ignore-line
) => value is infer U
	? U
	: never;

/* eslint-enable ts/naming-convention */

/**
 * Type guard utility function that always returns true.
 *
 * @template T
 * @param typed - The type to typecheck against.
 * @returns Always true.
 */
export function is<T>(typed: unknown): typed is T {
	return true;
}

/**
 * Type utility function for using generalized iteration. Use $range for loops
 * for arrays.
 *
 * @template T
 * @param object - The table to iterate over.
 * @returns A mapify'ied type of T.
 */
export function iterate<T>(object: T): Mapify<Entries<Required<T>>> {
	return object as never;
}

/**
 * Type utility function to lazily force type to be required.
 *
 * @template T
 * @param object - The table to make required.
 * @returns An required type of T.
 */
export function required<T>(object: T): Required<T> {
	return object as never;
}

/**
 * Type utility function to force assert a condition without erroring.
 *
 * @template T
 * @param condition - The condition to assert.
 */
export function typeAssert<T>(condition: T): asserts condition {}

/**
 * Type utility function to force assert a variable with a type.
 *
 * @template T - The type to assert as.
 * @param typed - The variable to assert.
 */
export function typeAssertIs<T>(typed: unknown): asserts typed is T {}

/**
 * Type utility function to get a member (property or method) from an object
 * without calling it.
 *
 * @template T, U
 * @param object - The object to get the member from.
 * @param key - The name of the member to get.
 * @returns The member without calling it.
 */
export function getMember<T, U extends keyof T>(object: T, key: U): T[U] {
	return object[key];
}

/**
 * Forces a value to be of type T, bypassing type inference.
 *
 * @template T
 * @template S - Whether the parameter 't' should satisfy the type 'T'.
 * @param value - The value to be forced to type T.
 * @returns The value, asserted to be of type T.
 */
export function force<T, S extends boolean = false>(value?: S extends true ? T : unknown): T {
	return value as T;
}

/* eslint-disable jsdoc/require-param-description -- From flamework's modding API. */
/**
 * This function is able to utilize Flamework's user macros to generate and
 * inspect types. This function supports all values natively supported by
 * Flamework's user macros.
 *
 * For example, if you want to retrieve the properties of an instance, you could
 * write code like this:.
 *
 * ```ts
 * // Returns an array of all keys part of the union.
 * const basePartKeys =
 * 	Modding.inspect<InstancePropertyNames<BasePart>[]>();
 * ```
 *
 * @param value
 * @metadata macro
 */
export function inspect<T>(value?: Modding.Many<T>): T {
	return value as never;
}
/* eslint-enable jsdoc/require-param-description */

const flowSymbol = Symbol.for("flow");
/**
 * Conditionally returns an array containing a unique symbol if the provided
 * condition is true, otherwise returns an empty array. This is useful for
 * triggering code execution within a `for...of` loop only when the condition is
 * met.
 *
 * @param run - A boolean value determining whether to return the symbol or an
 *   empty array.
 * @returns An array containing the `flowSymbol` if `run` is true, otherwise an
 *   empty array.
 */
export function flow(run: boolean): [] | [typeof flowSymbol] {
	return run ? [flowSymbol] : [];
}

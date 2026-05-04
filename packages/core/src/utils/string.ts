import type { CamelCase, PascalCase, ValueOf } from "type-fest";

import { type formatMode, formatTable as formatTableImpl } from "./formatTable";
import type { KeyValueString, LookupKeyIgnoreCase, StringIncludes } from "./type";
import { iterate } from "./type";

/**
 * Converts a string to PascalCase by uppercasing the first character.
 *
 * @param str - The string to convert.
 * @returns The PascalCase form of the input string.
 * @example
 * ```ts
 * const result = toPascalCase("helloWorld"); // "HelloWorld"
 * ```
 * @remarks
 * Only the first character is uppercased; the rest of the string remains
 * unchanged.
 */
export function toPascalCase<T extends string>(str: T): PascalCase<T> {
	return `${str.sub(1, 1).upper()}${str.sub(1 + 1, -1)}` as never;
}

/**
 * Checks if a string is in PascalCase (first character is uppercase).
 *
 * @param str - The string to check.
 * @returns `true` if the first character is uppercase, `false` otherwise.
 * @example
 * ```ts
 * isPascalCase("HelloWorld"); // true
 * isPascalCase("helloWorld"); // false
 * ```
 */
export function isPascalCase(str: string): boolean {
	return str.sub(1, 1).upper() === str.sub(1, 1);
}

/**
 * Converts a string to camelCase by lowercasing the first character.
 *
 * @param str - The string to convert.
 * @returns The camelCase form of the input string.
 * @example
 * ```ts
 * const result = toCamelCase("HelloWorld"); // "helloWorld"
 * ```
 * @remarks
 * Only the first character is lowercased; the rest of the string remains
 * unchanged.
 */
export function toCamelCase<T extends string>(str: T): CamelCase<T> {
	return `${str.sub(1, 1).lower()}${str.sub(1 + 1, -1)}` as never;
}

/**
 * Checks if a string is in camelCase (first character is lowercase).
 *
 * @param str - The string to check.
 * @returns `true` if the first character is lowercase, `false` otherwise.
 * @example
 * ```ts
 * isCamelCase("helloWorld"); // true
 * isCamelCase("HelloWorld"); // false
 * ```
 */
export function isCamelCase(str: string): boolean {
	return str.sub(1, 1).lower() === str.sub(1, 1);
}

/**
 * Formats a table into a string representation using the specified
 * formatting mode.
 *
 * @param object - The table to format.
 * @param mode - The formatting mode to use.
 * @returns The formatted string representation of the table.
 * @example
 * ```ts
 * const formatted = formatTable({ a: 1, b: 2 }, formatMode.Pretty);
 * ```
 */
export function formatTable(object: Table, mode: ValueOf<typeof formatMode>): string {
	return formatTableImpl(object, mode);
}

/**
 * Looks up a key in an object case-insensitively.
 *
 * @param key - The key to search for.
 * @param object - The object to search in.
 * @returns The matching key from the object, or `undefined` if not found.
 * @example
 * ```ts
 * const key = lookupKeyIgnoreCase("HELLO", { hello: "world" }); // "hello"
 * ```
 * @remarks
 * The search iterates over all keys in the object and compares them
 * case-insensitively using `string.lower()`.
 */
export function lookupKeyIgnoreCase<A extends object, B extends string>(
	key: B,
	object: A,
): N<LookupKeyIgnoreCase<A, B>> {
	for (const [foundKey] of iterate(object as object)) {
		if ((foundKey as string).lower() === key.lower()) {
			return foundKey;
		}
 	}

	return undefined;
}

/**
 * Flattens a nested object into an array of key-value path strings.
 *
 * @param object - The object or value to flatten.
 * @param separator - The separator to use between path segments.
 * @returns An array of path strings representing the flattened key-value
 *   pairs.
 * @example
 * ```ts
 * const paths = toPath({ a: { b: "c" } }, ".");
 * // ["a.b.c"]
 * ```
 * @remarks
 * If the input is not a table, it is returned as a single-element array
 * containing the stringified value.
 */
export function toPath<T, S extends string>(
	object: T,
	separator: S,
): Array<KeyValueString<T, S>> {
	if (!typeIs(object, "table")) {
		return [tostring(object) as KeyValueString<T, S>];
	}

	const paths: Array<KeyValueString<T, S>> = [];

	for (const [key, value] of iterate(object)) {
		const nestedPaths = toPath(value, separator);

		if (typeIs(nestedPaths, "table")) {
			// If nested value returns multiple paths, prepend current key to each
			for (const nestedPath of nestedPaths) {
				const path = `${tostring(key)}${separator}${nestedPath}`;
				paths.push(path as KeyValueString<T, S>);
			}
		}
 	}

	return paths;
}

/**
 * Checks if a string contains a given substring.
 *
 * @param str - The string to search in.
 * @param stringToCheck - The substring to search for.
 * @returns `true` if the substring is found, `false` otherwise.
 * @example
 * ```ts
 * includes("hello world", "world"); // true
 * ```
 */
export function includes<A extends string, B extends string>(
	str: A,
	stringToCheck: B,
): StringIncludes<A, B> {
	// eslint-disable-next-line no-restricted-syntax -- Inbuilt function
	return (str.find(stringToCheck)[0] !== undefined) as StringIncludes<A, B>;
}

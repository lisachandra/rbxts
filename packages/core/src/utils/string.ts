import type { CamelCase, PascalCase, ValueOf } from "type-fest";

import { type formatMode, formatTable as formatTableImpl } from "./formatTable";
import type { KeyValueString, LookupKeyIgnoreCase, StringIncludes } from "./type";
import { iterate } from "./type";

export function toPascalCase<T extends string>(str: T): PascalCase<T> {
	return `${str.sub(1, 1).upper()}${str.sub(1 + 1, -1)}` as never;
}

export function isPascalCase(str: string): boolean {
	return str.sub(1, 1).upper() === str.sub(1, 1);
}

export function toCamelCase<T extends string>(str: T): CamelCase<T> {
	return `${str.sub(1, 1).lower()}${str.sub(1 + 1, -1)}` as never;
}

export function isCamelCase(str: string): boolean {
	return str.sub(1, 1).lower() === str.sub(1, 1);
}

export function formatTable(object: Table, mode: ValueOf<typeof formatMode>): string {
	return formatTableImpl(object, mode);
}

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

export function includes<A extends string, B extends string>(
	str: A,
	stringToCheck: B,
): StringIncludes<A, B> {
	// eslint-disable-next-line no-restricted-syntax -- Inbuilt function
	return (str.find(stringToCheck)[0] !== undefined) as StringIncludes<A, B>;
}

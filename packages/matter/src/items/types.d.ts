/*
 * This module defines utility types for working with item data. It includes
 * types for validating PascalCase paths, extracting data, and excluding
 * PascalCase properties.
 */

import { Component } from "@rbxts/matter";
import { ValidItemPath } from "./definitions";

export type ItemContainer = Component<{ items: Array<Item> }>;

export type ExtractItemWithId<P extends ValidItemPath> = Extract<
	ValidItemPath,
	[...P, ...Array<string>]
>;
export type ItemHierarchyIds<
	P extends ValidItemPath,
	ExcludeParent extends N<boolean>,
> = ExcludeParent extends true ? Exclude<ExtractItemWithId<P>, P> : ExtractItemWithId<P>;

export type ValidPascalCasePath<T> = T extends object
	? {
			[K in PascalCaseKeys<T>]: [K] | [K, ...ValidPascalCasePath<T[K]>];
		}[PascalCaseKeys<T>]
	: [];

export type IsPascalCase<S extends string> = S extends `${infer F}${infer _R}`
	? F extends Uppercase<F>
		? true
		: false
	: false;

export type PascalCaseKeys<T> = {
	[K in keyof T]: K extends string ? (IsPascalCase<K> extends true ? K : never) : never;
}[keyof T];

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

export type ExcludePascalCaseProperties<T extends object> = Omit<T, PascalCaseKeys<T>>;

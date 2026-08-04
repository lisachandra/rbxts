import { freezeDeep } from "@rbxts/sift/Dictionary";
import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

import { humanoid, type Humanoid as ValidatedHumanoid } from "./humanoid";
import type { R6Character } from "./r6Character";
import { r6Character } from "./r6Character";
import { r15Character } from "./r15Character";

/** Represents an R6 character model schema. */
export type Character = R6Character;

/** A validated Humanoid instance tree with a parent {@link Character}. */
export type Humanoid = ValidatedHumanoid;

/**
 * Extracts the instance tree type from an {@link EvaluateInstanceTree} wrapper.
 *
 * @example
 * 	```ts
 * 	type Tree = EvaluateInstanceTree<typeof r6Character>;
 * 	type Extracted = ExtractInstanceTree<Tree>;
 * 	```;
 *
 * @typeParam T - An {@link EvaluateInstanceTree} type to unwrap.
 */
export type ExtractInstanceTree<T> = T extends EvaluateInstanceTree<infer U> ? U : never;

/**
 * Filters properties of `T` to only those whose `$className` matches `U`.
 *
 * @remarks
 *   For each property in `T`, if the property has a `$className` field matching `U` or is itself a
 *   string literal matching `U`, it is included in the resulting type.
 * @example
 * 	```ts
 * 	type Parts = WithClass<Character, "Part">;
 * 	```;
 *
 * @typeParam T - The object type to filter.
 * @typeParam U - The class name string to match against `$className`.
 */
export type WithClass<T extends object, U extends string> = {
	[K in keyof T as T[K] extends object
		? "$className" extends keyof T[K]
			? T[K]["$className"] extends U
				? K
				: never
			: never
		: T[K] extends U
			? K
			: never]: T[K];
};

/**
 * Registry of all entity schemas used for instance tree validation.
 *
 * @remarks
 *   The schemas are deeply frozen to prevent accidental mutation. Includes `humanoid`,
 *   `r6Character`, and `r15Character` schemas.
 */
export const schemas = freezeDeep({
	humanoid,
	r6Character,
	r15Character,
});

import { freezeDeep } from "@rbxts/sift/out/Dictionary";
import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

import { humanoid, type Humanoid as ValidatedHumanoid } from "./humanoid";
import type { R6Character } from "./r6Character";
import { r6Character } from "./r6Character";
import { r15Character } from "./r15Character";

export type Character = R6Character;

export type Humanoid = ValidatedHumanoid;

export type ExtractInstanceTree<T> = T extends EvaluateInstanceTree<infer U> ? U : never;

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

export const schemas = freezeDeep({
	humanoid,
	r6Character,
	r15Character,
});

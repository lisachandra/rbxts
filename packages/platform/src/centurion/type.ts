/*
 * ──────────────────────────────────────────────
 * Augmentable Centurion user-type interface
 *
 * External packages and consumers add entries via declaration merging:
 *
 *   declare module "@lisachandra/platform/centurion/type" {
 *       interface CenturionUserTypes {
 *           Item: "item";
 *           PlayerEntities: "playerEntities";
 *       }
 *   }
 * ──────────────────────────────────────────────
 */

/**
 * Augmentable interface mapping user-type keys to their Centurion argument type name strings.
 *
 * @remarks
 *   External packages and consumers should augment this interface via `declare module` so that all
 *   centurion types across the entire codebase are discoverable from a single import location —
 *   `@lisachandra/platform`.
 */
export interface CenturionUserTypes {
	Entities: "entities";
	Entity: "entity";
}

/** Set of keys for all registered Centurion user argument types. */
export type CenturionUserTypeKey = keyof CenturionUserTypes;

/*
 * ──────────────────────────────────────────────
 * Runtime type name registry
 * ──────────────────────────────────────────────
 */

/**
 * The single source of truth for all Centurion user-type name constants.
 *
 * Mirrors `CenturionType` from `@rbxts/centurion`. Consumers and external packages extend this
 * object via {@link registerCenturionType}, so `CenturionUserType.Foo` resolves to `"foo"` at both
 * compile time and runtime — no manual spreading needed.
 *
 * @example
 * 	```ts
 * 	import { CenturionUserType } from "@lisachandra/platform";
 *
 * 	// Use directly in command argument definitions:
 * 	arguments: [{ type: CenturionUserType.Entity, name: "target", ... }]
 * 	```;
 */
export const CenturionUserType: Record<string, string> = {
	Entities: "entities",
	Entity: "entity",
};

/**
 * Registers a custom Centurion argument type at runtime, adding it directly to
 * {@link CenturionUserType}.
 *
 * Pair with a `declare module` augmentation of {@link CenturionUserTypes} so the key is known at
 * compile time as well.
 *
 * @example
 * 	```ts
 * 	declare module "@lisachandra/platform/centurion/type" {
 * 		interface CenturionUserTypes {
 * 			Item: "item";
 * 		}
 * 	}
 * 	registerCenturionType("Item", "item");
 * 	// CenturionUserType.Item === "item"
 * 	```;
 *
 * @param key - The type key to register.
 * @param name - The string identifier used in Centurion command argument definitions (e.g. The
 *   `type` field).
 */
export function registerCenturionType(key: string, name: string): void {
	CenturionUserType[key] = name;
}

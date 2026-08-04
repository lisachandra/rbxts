import type { ValidPascalCasePath } from "./types";

/**
 * Represents the full item definitions tree type.
 *
 * @remarks
 *   Derived from `typeof itemDefinitions` so it stays in sync with the runtime definitions object.
 */
export type Items = typeof itemDefinitions;
/**
 * A tuple of PascalCase strings representing a valid path through the item hierarchy (e.g.,
 * `["Weapon", "Sword"]`).
 */
export type ValidItemPath = ValidPascalCasePath<Items>;

/**
 * Maps item paths to arrays of keys that should be excluded from network replication.
 *
 * @remarks
 *   Populated by `defineItems` when items specify `privateKeys`. These keys are stripped before
 *   sending item data to clients.
 */
export const privateDefinitions = new Map<ValidItemPath, Array<string>>();
/**
 * The root item definitions tree. Each PascalCase key represents a branch in the item hierarchy,
 * and leaf nodes contain default data values.
 *
 * @remarks
 *   Populated by `defineItems`. The `None` key provides a default empty item.
 */
export const itemDefinitions = {
	None: {},
};

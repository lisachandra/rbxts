import { freezeDeep } from "@rbxts/sift/Dictionary";
import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

import type { Character } from "./index";

/**
 * A validated Humanoid instance tree with an Animator child and a {@link Character} parent.
 */
export type Humanoid = EvaluateInstanceTree<typeof humanoid> & { Parent: Character };

/**
 * Schema for validating a Humanoid instance tree.
 *
 * @remarks
 * Validates that a Humanoid instance contains an Animator child.
 * The parent is expected to be a {@link Character} model.
 */
export const humanoid = freezeDeep({
	$className: "Humanoid",
	Animator: "Animator",
} as const);

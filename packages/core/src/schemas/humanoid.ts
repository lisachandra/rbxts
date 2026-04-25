import { freezeDeep } from "@rbxts/sift/out/Dictionary";
import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

import type { Character } from "./index";

export type Humanoid = EvaluateInstanceTree<typeof humanoid> & { Parent: Character };

export const humanoid = freezeDeep({
	$className: "Humanoid",
	Animator: "Animator",
} as const);

import type { ValidPascalCasePath } from "./types";

export type Items = typeof itemDefinitions
export type ValidItemPath = ValidPascalCasePath<Items>;

export const privateDefinitions = new Map<ValidItemPath, Array<string>>();
export const itemDefinitions = {
	None: {}
};

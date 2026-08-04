import type { Items } from "./definitions";
import type { PascalCaseKeys } from "./types";

type Descriptions<T> = T extends object
	? {
			[K in PascalCaseKeys<T>]: Partial<Descriptions<T[K]>> & {
				description: string;
				image: string;
			};
		}
	: never;

/**
 * Stores user-facing descriptions and images for each item in the hierarchy.
 *
 * @remarks
 *   Populated by `defineItems`. Each entry maps to an object with `description` and `image` fields
 *   for tooltips and UI display.
 */
export const descriptions: Partial<Descriptions<Items>> = {};

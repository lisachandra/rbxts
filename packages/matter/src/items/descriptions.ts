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

export const descriptions: Partial<Descriptions<Items>> = {};

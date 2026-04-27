import type { Binding } from "@rbxts/react";
import { createContext } from "@rbxts/react";

export type PxFetchValue<T = number> = (value: T) => T;

/**
 * Provides methods for scaling UI elements based on viewport size.
 */
export interface PxWithMethods {
	(value: number): number;
	ceil: (value: number) => number;
	even: (value: number) => number;
	fetch: (f?: (n: number) => number, ...args: Array<string>) => PxFetchValue<number>;
	floor: (value: number) => number;
	fromUDim: {
		(udim: UDim): UDim;
		(scalingFunc: (n: number) => number): (udim: UDim) => UDim;
		(udim: UDim, scalingFunc: (n: number) => number): UDim;
	};
	fromUDim2: {
		(udim2: UDim2): UDim2;
		(scalingFunc: (n: number) => number): (udim2: UDim2) => UDim2;
		(udim2: UDim2, scalingFunc: (n: number) => number): UDim2;
	};
	scale: (value: number) => number;
}

export interface AppContextObject {
	contextMenu?: string;
	px: PxWithMethods;
	screen: Binding<Vector2>;
	viewport: Binding<Vector2>;
}

const AppContext = createContext<AppContextObject>({} as AppContextObject);

export default AppContext;

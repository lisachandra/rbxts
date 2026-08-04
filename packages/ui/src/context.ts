import type { FetchValue } from "@lisachandra/react-template";
import type { Binding } from "@rbxts/react";
import { createContext } from "@rbxts/react";

/**
 * Provides methods for scaling UI elements based on viewport size. Offers various rounding options
 * and UDim conversion utilities. Uses a base resolution and dominant axis to calculate scaling
 * factor. Can be called directly as a function for rounded scaling.
 */
export interface PxWithMethods {
	/** Scales `pixels` based on the current viewport size and rounds the result. */
	(value: number): number;

	/** Scales `pixels` and rounds the result up. Useful for ensuring minimum sizes. */
	ceil: (value: number) => number;

	/**
	 * Scales `pixels` and rounds the result to the nearest even number. Useful for ensuring
	 * consistent alignment.
	 */
	even: (value: number) => number;

	/**
	 * Creates a reactive value that dynamically scales a value. Useful for binding UI template
	 * element sizes to the viewport. Uses rounded scaling by default, but accepts a custom scaling
	 * function.
	 *
	 * @example
	 * 	```tsx
	 * 	// Rounded scaling using px function
	 * 	const scaledSize = px.fetch(); // equivalent to px.fetch(px)
	 * 	// Even scaling
	 * 	const evenScaledSize = px.fetch(px.even);
	 * 	// Get scaled px size from a template property
	 * 	return (
	 * 	<TextLabelTemplate
	 * 	TextSize={px.fetch()},
	 * 	Size={px.fetch(px.fromUDim2)},
	 * 	Position={px.fetch(px.fromUDim2(px.floor))}
	 * 	/>
	 * 	);
	 * 	```;
	 */
	fetch: (f?: Callback, ...args: Array<string>) => FetchValue<number>;

	/** Scales `pixels` and rounds the result down. Useful for preventing overflow. */
	floor: (value: number) => number;

	/**
	 * Scales a UDim's offset value. Accepts a custom scaling function or defaults to rounded
	 * scaling. Can also be partially applied for deferred scaling of UDim objects.
	 *
	 * @example
	 * 	```ts
	 * 	// Direct usage
	 * 	const scaledUDim = px.fromUDim(new UDim(0, 100));
	 *
	 * 	// Partial application and deferred scaling
	 * 	const scaleUDimOffset = px.fromUDim(px.even);
	 * 	const anotherScaledUDim = scaleUDimOffset(new UDim(0, 100));
	 *
	 * 	// With a custom scaling function
	 * 	const customScaledUDim = px.fromUDim(new UDim(0, 100), (n) => n * 2);
	 * 	```;
	 */
	fromUDim: {
		/** Scales a UDim's offset value using the default rounded scaling. */
		(udim: UDim): UDim;

		/**
		 * Partial application: returns a function that scales UDim offset values using the provided
		 * scaling function.
		 */
		(scalingFunc: (n: number) => number): (udim: UDim) => UDim;

		/** Scales a UDim's offset value using a custom scaling function. */
		(udim: UDim, scalingFunc: (n: number) => number): UDim;
	};

	/**
	 * Scales a UDim2's offset values. Accepts a custom scaling function or defaults to rounded
	 * scaling. Can also be partially applied for deferred scaling of UDim2 objects.
	 *
	 * @example
	 * 	```ts
	 * 	// Direct usage
	 * 	const scaledUDim = px.fromUDim2(new UDim2(0, 100, 0, 50));
	 *
	 * 	// Partial application and deferred scaling
	 * 	const scaleUDimOffset = px.fromUDim2(px.even);
	 * 	const anotherScaledUDim = scaleUDimOffset(new UDim2(0, 100, 0, 50));
	 *
	 * 	// With a custom scaling function
	 * 	const customScaledUDim = px.fromUDim2(new UDim2(0, 100, 0, 50), (n) => n * 2);
	 * 	```;
	 */
	fromUDim2: {
		/** Scales a UDim2's offset values using the default rounded scaling. */
		(udim2: UDim2): UDim2;

		/**
		 * Partial application: returns a function that scales UDim2 offset values using the
		 * provided scaling function.
		 */
		(scalingFunc: (n: number) => number): (udim2: UDim2) => UDim2;

		/** Scales a UDim2's offset values using a custom scaling function. */
		(udim2: UDim2, scalingFunc: (n: number) => number): UDim2;
	};

	/**
	 * Scales a number based on the current viewport size without rounding. Provides raw scaled
	 * value.
	 */
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

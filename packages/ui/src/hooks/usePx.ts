import ReactTemplate from "@lisachandra/react-template";
import { useBindingListener } from "@rbxts/pretty-react-hooks";
import type { Binding } from "@rbxts/react";
import { useMemo, useState } from "@rbxts/react";

import type { PxWithMethods } from "../context";

const base = {
	dominantAxis: 1,
	horizontalResolution: 1920,
	minimumScale: 0.5,
	verticalResolution: 1080,
};

/** Computes scaling factors for UI elements based on viewport dimensions. */
export function computePx(viewport: Vector2): number {
	const width = math.log(viewport.X / base.horizontalResolution, 2);
	const height = math.log(viewport.Y / base.verticalResolution, 2);
	const centered = width + (height - width) * base.dominantAxis;

	return math.max(2 ** centered, base.minimumScale);
}

/** A hook to manage `px` scaling with live updates when viewport changes. */
export function usePx(viewportBinding: Binding<Vector2>): PxWithMethods {
	const [pxScale, setPxScale] = useState(1);

	const pxMethods = useMemo(() => {
		const pxCall = (value: number): number => math.round(value * pxScale);

		const px = {
			ceil: (value: number) => math.ceil(value * pxScale),
			even: (value: number) => math.round(value * pxScale * 0.5) * 2,
			fetch: (func?: Callback, ...args: Array<string>) => {
				return ReactTemplate.fetch(func ?? ((number: number) => pxCall(number)), ...args);
			},
			floor: (value: number) => math.floor(value * pxScale),
			fromUDim: (
				udimOrPxFunction?: UDim | ((number: number) => number),
				pxFunction?: (number: number) => number,
			) => {
				let func: undefined | ((number: number) => number) = pxFunction;

				if (typeIs(udimOrPxFunction, "function")) {
					func = udimOrPxFunction;
					return (udim: UDim) => px.fromUDim(udim, func);
				}

				if (!typeIs(udimOrPxFunction, "UDim")) {
					error(`px.fromUDim: invalid UDim argument: ${udimOrPxFunction}`);
				}

				func ??= (number: number) => pxCall(number);

				return new UDim(udimOrPxFunction.Scale, func(udimOrPxFunction.Offset));
			},
			fromUDim2: (
				udim2OrPxFunction?: UDim2 | ((number: number) => number),
				pxFunction?: (number: number) => number,
			) => {
				let func: undefined | ((number: number) => number) = pxFunction;

				if (typeIs(udim2OrPxFunction, "function")) {
					func = udim2OrPxFunction;
					return (udim2: UDim2) => px.fromUDim2(udim2, func);
				}

				if (!typeIs(udim2OrPxFunction, "UDim2")) {
					error(`px.fromUDim2: invalid UDim2 argument: ${udim2OrPxFunction}`);
				}

				func ??= (number: number) => pxCall(number);

				return new UDim2(
					udim2OrPxFunction.X.Scale,
					func(udim2OrPxFunction.X.Offset),
					udim2OrPxFunction.Y.Scale,
					func(udim2OrPxFunction.Y.Offset),
				);
			},
			scale: (value: number) => value * pxScale,
		};

		setmetatable(px, {
			// eslint-disable-next-line ts/naming-convention -- Metatable definition
			__call: (_, value) => pxCall(value as number),
		});

		return px;
	}, [pxScale]);

	useBindingListener(viewportBinding, (viewport: Vector2) => {
		setPxScale(computePx(viewport));
	});

	return pxMethods as PxWithMethods;
}

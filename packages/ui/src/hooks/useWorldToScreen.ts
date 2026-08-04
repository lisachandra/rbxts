import { useBindingListener } from "@rbxts/pretty-react-hooks";
import type { Binding } from "@rbxts/react";
import { useBinding, useCallback, useContext } from "@rbxts/react";
import { Workspace } from "@rbxts/services";

import AppContext from "../context";

export interface WorldToScreenResult {
	onScreen: boolean;
	position: UDim2;
	size: UDim2;
}

/** Projects a world position to screen space with scaling. */
export function projectWorldToScreen(
	worldPosition: Vector3,
	baseSize: Vector2,
	px: (n: number) => number,
): undefined | WorldToScreenResult {
	const camera = Workspace.CurrentCamera;
	if (!camera) {
		return;
	}

	const [screenPosition, onScreen] = camera.WorldToViewportPoint(worldPosition);
	if (!onScreen) {
		return;
	}

	const frustumHeight = math.tan(math.rad(camera.FieldOfView / 2)) * (screenPosition.Z * 2);
	if (frustumHeight <= 0) {
		return;
	}

	const scaleFactor = camera.ViewportSize.Y / frustumHeight;
	const size = baseSize.mul(scaleFactor);
	const position = new Vector2(screenPosition.X, screenPosition.Y).sub(size.mul(0.5));

	return {
		onScreen: true,
		position: UDim2.fromOffset(position.X, position.Y),
		size: UDim2.fromOffset(px(size.X), px(size.Y)),
	};
}

/** Hook to project a world position to screen space with distance scaling. */
export function useWorldToScreen(
	worldPosition: Binding<Vector3>,
	size: Binding<Vector2>,
): Binding<WorldToScreenResult> {
	const { px } = useContext(AppContext);
	const [data, setData] = useBinding<WorldToScreenResult>({
		onScreen: false,
		position: new UDim2(),
		size: new UDim2(),
	});

	useBindingListener(
		worldPosition,
		useCallback(
			(position: Vector3) => {
				const result = projectWorldToScreen(position, size.getValue(), px);
				if (result) {
					setData(result);
				} else {
					setData({ onScreen: false, position: new UDim2(), size: new UDim2() });
				}
			},
			[px],
		),
	);

	return data;
}

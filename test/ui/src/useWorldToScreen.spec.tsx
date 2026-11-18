import { describeEachReactMode } from "@lisachandra/test/react";
import type { PxWithMethods } from "@lisachandra/ui";
import { AppContext } from "@lisachandra/ui";
import { projectWorldToScreen, useWorldToScreen } from "@lisachandra/ui/hooks/useWorldToScreen";
import { describe, expect, it } from "@rbxts/jest-globals";
import * as React from "@rbxts/react";
import { createBinding } from "@rbxts/react";
import { Workspace } from "@rbxts/services";

/*
 * Ported from the godkin repo's `client/ui/hooks/useWorldToScreen.spec.ts` (#17 triage: direct).
 *
 * Split the same way as `usePx`: `projectWorldToScreen` is pure given a camera, so it gets plain
 * assertions; `useWorldToScreen` needs a binding, a context and a render, so it goes through
 * `describeEachReactMode`.
 *
 * The upstream spec reached the camera by mocking `@rbxts/services` wholesale, then asserted only
 * that the result was defined. The emulator has a real camera (1920x1080, 70° FOV), so the cases
 * below drive it directly and pin the actual arithmetic.
 *
 * What `baseSize` means is the thing to get right: it is the object's size **in studs**, and the
 * function converts studs to pixels via the frustum. A 100x100 input at 10 studs is therefore a
 * ~7700px box, not a 100px one — an early draft of this port assumed pixels and every expectation
 * was off by the same factor.
 */

function camera(): Camera {
	const current = Workspace.CurrentCamera as Camera | undefined;
	assert(current !== undefined, "the emulator must provide a camera");

	return current;
}

function aheadOf(studs: number): Vector3 {
	const view = camera();

	return view.CFrame.Position.add(view.CFrame.LookVector.mul(studs));
}

describe("projectWorldToScreen", () => {
	it("should project a point straight ahead onto the viewport centre", () => {
		expect.assertions(2);

		const result = projectWorldToScreen(aheadOf(10), new Vector2(100, 100), (value) => value);

		expect(result).toBeDefined();
		expect(result!.onScreen).toBe(true);
	});

	it("should centre the box on the projected point", () => {
		expect.assertions(2);

		/*
		 * The function subtracts half the projected size from the projected point, so a point at the
		 * screen's centre yields a position offset by exactly half the box in each axis. That is the
		 * only reason it takes `baseSize` at all, and it holds without knowing where the camera sits.
		 */
		const size = new Vector2(100, 100);
		const result = projectWorldToScreen(aheadOf(10), size, (value) => value)!;

		const viewport = camera().ViewportSize;
		const centreX = result.position.X.Offset + result.size.X.Offset / 2;
		const centreY = result.position.Y.Offset + result.size.Y.Offset / 2;

		/*
		 * A 2px tolerance rather than `toBeCloseTo`'s digit count: UDim offsets are integers, so the
		 * four rounded terms can each contribute half a pixel and the sum lands a couple of pixels off.
		 * The relationship is exact in real numbers and only loses precision at the integer boundary.
		 */
		expect(math.abs(centreX - viewport.X / 2)).toBeLessThanOrEqual(2);
		expect(math.abs(centreY - viewport.Y / 2)).toBeLessThanOrEqual(2);
	});

	it("should halve the box when the distance doubles", () => {
		expect.assertions(2);

		/*
		 * The frustum height is proportional to depth, so the scale — and the box — is inversely
		 * proportional to distance. This is the behaviour the hook exists for.
		 */
		const size = new Vector2(100, 100);
		const near = projectWorldToScreen(aheadOf(10), size, (value) => value)!;
		const far = projectWorldToScreen(aheadOf(20), size, (value) => value)!;

		// Tolerance in pixels, for the same integer-rounding reason as the centring spec.
		expect(math.abs(far.size.X.Offset - near.size.X.Offset / 2)).toBeLessThanOrEqual(2);
		expect(math.abs(far.size.Y.Offset - near.size.Y.Offset / 2)).toBeLessThanOrEqual(2);
	});

	it("should pass the box through px but not the position", () => {
		expect.assertions(3);

		/*
		 * The asymmetry is deliberate: `position` is already in viewport pixels, while `size` is a
		 * world measurement that has to be scaled for the UI. A refactor applying `px` to both would
		 * be invisible without this spec.
		 */
		const size = new Vector2(100, 100);
		const unscaled = projectWorldToScreen(aheadOf(10), size, (value) => value)!;
		const doubled = projectWorldToScreen(aheadOf(10), size, (value) => value * 2)!;

		expect(math.abs(doubled.size.X.Offset - unscaled.size.X.Offset * 2)).toBeLessThanOrEqual(4);
		expect(doubled.position.X.Offset).toBe(unscaled.position.X.Offset);
		expect(doubled.position.Y.Offset).toBe(unscaled.position.Y.Offset);
	});

	it("should answer undefined for a point behind the camera", () => {
		expect.assertions(1);

		/*
		 * `WorldToViewportPoint`'s second return is false behind the camera, and the function turns
		 * that into `undefined` rather than projecting to a mirrored position.
		 */
		const behind = aheadOf(-10);

		expect(
			projectWorldToScreen(behind, new Vector2(100, 100), (value) => value),
		).toBeUndefined();
	});
});

describe("useWorldToScreen", () => {
	describeEachReactMode("useWorldToScreen (%s)", ({ render }) => {
		const identityPx = ((value: number) => value) as PxWithMethods;

		/*
		 * `screen` and `viewport` belong to the context object but are not read by this hook, which
		 * only reads `px`. They get real bindings rather than stubs so that a future hook
		 * reading them gets sensible values instead of a nil dereference. `createBinding` is the
		 * non-hook form, which is what lets this be built once outside a render.
		 */
		const [screen] = createBinding(new Vector2());
		const [viewport] = createBinding(new Vector2(1920, 1080));
		const contextValue = { px: identityPx, screen, viewport };

		it("should start off screen with an empty box", () => {
			expect.assertions(2);

			let initial: undefined | { onScreen: boolean };

			function TestComponent() {
				const [position] = React.useBinding(new Vector3());
				const [size] = React.useBinding(new Vector2(100, 100));
				const result = useWorldToScreen(position, size);

				initial ??= result.getValue() as { onScreen: boolean };

				return <></>;
			}

			/*
			 * The hook seeds its binding with `onScreen: false` and zeroed UDim2s. That is what a
			 * consumer renders before the first listener fires, so it has to be the safe state — a
			 * "visible by default" seed would show a ghost box at the origin.
			 */
			const { unmount } = render(
				<AppContext.Provider value={contextValue}>
					<TestComponent />
				</AppContext.Provider>,
			);
			unmount();

			expect(initial).toBeDefined();
			expect(initial!.onScreen).toBe(false);
		});

		it("should return a binding rather than a value", () => {
			expect.assertions(2);

			let hasGetValue = false;
			let hasMap = false;

			function TestComponent() {
				const [position] = React.useBinding(new Vector3());
				const [size] = React.useBinding(new Vector2(100, 100));
				const result = useWorldToScreen(position, size);

				hasGetValue = typeIs(result.getValue, "function");
				hasMap = typeIs(result.map, "function");

				return <></>;
			}

			const { unmount } = render(
				<AppContext.Provider value={contextValue}>
					<TestComponent />
				</AppContext.Provider>,
			);
			unmount();

			expect(hasGetValue).toBe(true);
			expect(hasMap).toBe(true);
		});
	});
});

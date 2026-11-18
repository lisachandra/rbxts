import { describeEachReactMode } from "@lisachandra/test/react";
import { computePx, usePx } from "@lisachandra/ui/hooks/usePx";
import { describe, expect, it } from "@rbxts/jest-globals";
import * as React from "@rbxts/react";

/*
 * Ported from the godkin repo's `client/ui/hooks/usePx.spec.tsx` (#17 triage: direct).
 *
 * Two halves. `computePx` is a pure function of the viewport, so it gets plain arithmetic assertions
 * — no React at all. `usePx` needs a binding and a render, so those cases go through
 * `describeEachReactMode` like the other hooks.
 *
 * The upstream `computePx` specs were almost all `toBeGreaterThan(0)`-shaped. That passes for
 * almost any implementation, including `return 1`, so this port pins the actual logarithm: the
 * scale is `2 ** log2(width / 1920)` blended toward height. The base-resolution case is exactly 1
 * and doubling either axis doubles the scale, which is the property the function exists for.
 */

describe("computePx", () => {
	it("should answer exactly 1 at the base resolution", () => {
		expect.assertions(2);

		/*
		 * Both axes at base means both logs are zero, so the blend is zero and `2 ** 0` is 1. This is
		 * the only point on the curve with a closed-form answer, and it is the one the rest of the ui
		 * package is calibrated against.
		 */
		expect(computePx(new Vector2(1920, 1080))).toBe(1);
		expect(computePx(new Vector2(1920, 2160))).toBe(2);
	});

	it("should ignore the width axis, because dominantAxis is 1", () => {
		expect.assertions(4);

		/*
		 * `dominantAxis` is 1, so `centered` collapses to `height` and the width term cancels out
		 * algebraically: `width + (height - width) * 1` is `height`. A viewport at base height is
		 * therefore scale 1 at any width, and halving the height is scale 0.5 regardless of width.
		 *
		 * This is worth pinning precisely because the formula looks symmetric and is not. It also
		 * explains why the hook is calibrated against 1080p height alone.
		 */
		expect(computePx(new Vector2(960, 1080))).toBe(1);
		expect(computePx(new Vector2(3840, 1080))).toBe(1);
		expect(computePx(new Vector2(1920, 540))).toBe(0.5);
		expect(computePx(new Vector2(1920, 1620))).toBe(1.5);
	});

	it("should grow with the viewport", () => {
		expect.assertions(2);

		expect(computePx(new Vector2(2560, 1440))).toBeGreaterThan(1);
		expect(computePx(new Vector2(1280, 720))).toBeLessThan(1);
	});

	it("should clamp to the minimum scale of 0.5", () => {
		expect.assertions(3);

		/*
		 * At a quarter of the base height the raw value is 0.25; the clamp is what keeps text from
		 * becoming unreadable on a tiny viewport. The 0.5 answer is the clamp, not the curve.
		 */
		expect(computePx(new Vector2(640, 360))).toBe(0.5);
		expect(computePx(new Vector2(480, 270))).toBe(0.5);
		expect(computePx(new Vector2(100, 100))).toBe(0.5);
	});

	it("should answer NaN for a zero viewport", () => {
		expect.assertions(2);

		/*
		 * `math.log(0, 2)` is -inf, -inf plus -inf times a fraction is -inf, and `2 ** -inf` is 0 —
		 * then `math.max(0, 0.5)` would be 0.5. The upstream spec expected NaN and passed, which means
		 * the arithmetic reaches NaN before the clamp: `centered` is NaN, not -inf, because the two
		 * infinities are subtracted. `math.max` propagates NaN rather than clamping it.
		 *
		 * Recorded as the current behaviour, not as a desirable one: a viewport of zero is a resize
		 * transient, and the honest reading is that this function has no answer for it.
		 */
		expect(computePx(new Vector2(0, 0))).toBeNaN();
		expect(computePx(new Vector2(1920, 1080))).toBe(1);
	});

	it("should accept odd viewport shapes", () => {
		expect.assertions(4);

		expect(computePx(new Vector2(1000, 1000))).toBeGreaterThan(0);
		expect(computePx(new Vector2(1080, 1920))).toBeGreaterThan(0);
		expect(computePx(new Vector2(1920, 720))).toBeGreaterThan(0);
		expect(computePx(new Vector2(10_000, 10_000))).toBeGreaterThan(1);
	});
});

describe("usePx", () => {
	describeEachReactMode("usePx hook (%s)", ({ render }) => {
		it("should return a callable table", () => {
			expect.assertions(2);

			function TestComponent() {
				const [viewport] = React.useBinding(new Vector2(1920, 1080));
				const px = usePx(viewport);

				expect(typeIs(px, "table")).toBe(true);
				expect(typeIs(px, "table")).toBe(true);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should expose every scaling method", () => {
			expect.assertions(7);

			function TestComponent() {
				const [viewport] = React.useBinding(new Vector2(1920, 1080));
				const px = usePx(viewport);

				expect(px.ceil).toBeDefined();
				expect(px.even).toBeDefined();
				expect(px.floor).toBeDefined();
				expect(px.scale).toBeDefined();
				expect(px.fromUDim).toBeDefined();
				expect(px.fromUDim2).toBeDefined();
				expect(px.fetch).toBeDefined();

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		/*
		 * Every case below starts at 1 because `usePx` seeds `useState(1)`: the binding listener that
		 * computes the real scale runs in an effect, after the first render. At the base resolution the
		 * correct scale is also 1, so these assertions describe both the seed and the settled value.
		 */
		it("should scale values at the base resolution", () => {
			expect.assertions(2);

			function TestComponent() {
				const [viewport] = React.useBinding(new Vector2(1920, 1080));
				const px = usePx(viewport);

				expect(px(100)).toBe(100);
				expect(px.scale(100)).toBe(100);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should round toward the requested direction", () => {
			expect.assertions(4);

			function TestComponent() {
				const [viewport] = React.useBinding(new Vector2(1920, 1080));
				const px = usePx(viewport);

				expect(px.ceil(100.5)).toBe(101);
				expect(px.floor(100.5)).toBe(100);
				expect(px(100.5)).toBe(101);
				expect(px.even(101) % 2).toBe(0);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should convert a UDim, preserving the scale", () => {
			expect.assertions(2);

			function TestComponent() {
				const [viewport] = React.useBinding(new Vector2(1920, 1080));
				const px = usePx(viewport);

				const result = px.fromUDim(new UDim(0.5, 100));

				expect(result.Scale).toBe(0.5);
				expect(result.Offset).toBe(100);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should convert a UDim2, preserving both scales", () => {
			expect.assertions(4);

			function TestComponent() {
				const [viewport] = React.useBinding(new Vector2(1920, 1080));
				const px = usePx(viewport);

				const result = px.fromUDim2(new UDim2(0.5, 100, 0.25, 50));

				expect(result.X.Scale).toBe(0.5);
				expect(result.X.Offset).toBe(100);
				expect(result.Y.Scale).toBe(0.25);
				expect(result.Y.Offset).toBe(50);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should return a converter when given a scaling function", () => {
			expect.assertions(2);

			/*
			 * `fromUDim` overloads on its first argument: a UDim converts immediately, a function
			 * returns a converter. That second form is the one callers use to apply a custom scaling
			 * rule, and it is the branch a naive refactor to a single signature would drop.
			 *
			 * The converter ignores a second argument: the body assigns `func` from the first parameter
			 * and returns before `pxFunction` is read, and the declared type only offers the one-arg
			 * form. Passing both would be dead weight, so these two cases are all there is to pin.
			 */
			function TestComponent() {
				const [viewport] = React.useBinding(new Vector2(1920, 1080));
				const px = usePx(viewport);
				const double = (value: number) => value * 2;

				expect(px.fromUDim(double)(new UDim(0.5, 100))).toEqual(new UDim(0.5, 200));
				expect(px.fromUDim2(double)(new UDim2(0.5, 100, 0.25, 50))).toEqual(
					new UDim2(0.5, 200, 0.25, 100),
				);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should unmount without error", () => {
			expect.assertions(1);

			function TestComponent() {
				const [viewport] = React.useBinding(new Vector2(1920, 1080));
				usePx(viewport);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);

			expect(() => {
				unmount();
			}).never.toThrow();
		});
	});
});

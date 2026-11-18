import { describeEachReactMode } from "@lisachandra/test/react";
import { useConstant } from "@lisachandra/ui/hooks/useConstant";
import { describe, expect, it } from "@rbxts/jest-globals";
import * as React from "@rbxts/react";

/*
 * Ported from the godkin repo's `client/ui/hooks/useConstant.spec.tsx` (#17 triage: direct).
 *
 * The upstream spec wrapped every case in a component and asserted from inside the render body,
 * which is the only way to observe a hook. That shape is kept: the assertions run during render, so
 * a `toBe` inside `TestComponent` is what proves the value the hook handed back.
 *
 * The godkin harness also ran each suite twice, once under `React.StrictMode`. That double-invokes
 * render, which is precisely the pressure `useConstant` has to survive — `ref.current ??= {...}` must
 * not run the factory twice when React renders twice. `describeEachReactMode` provides both modes.
 *
 * The outer `describe` is for the linter, not the runner: `require-top-level-describe` cannot see
 * through `describeEachReactMode`, which expands to `describe.each` at call time.
 */
describe("useConstant", () => {
	describeEachReactMode("useConstant (%s)", ({ render }) => {
		it("should return the value the factory produced", () => {
			expect.assertions(1);

			const expected = { count: 42 };

			function TestComponent() {
				expect(useConstant(() => expected)).toBe(expected);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should return primitives unchanged", () => {
			expect.assertions(2);

			function TestComponent() {
				expect(useConstant(() => 123)).toBe(123);
				expect(useConstant(() => "test string")).toBe("test string");

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should return undefined when the factory returns undefined", () => {
			expect.assertions(1);

			function TestComponent() {
				// oxlint-disable-next-line no-confusing-void-expression -- a void factory is the case
				expect(useConstant(() => {})).toBeUndefined();

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should call the factory exactly once across re-renders", () => {
			expect.assertions(3);

			let calls = 0;
			let result: unknown;
			const expected = { value: "test" };

			function TestComponent() {
				result = useConstant(() => {
					calls += 1;
					return expected;
				});

				return <></>;
			}

			const { rerender, unmount } = render(<TestComponent />);

			/*
			 * Strict mode renders twice before this line. A factory guarded by a plain field rather than
			 * by `ref.current ??=` would already be at 2 here, which is why this assertion is the one
			 * that makes the doubled render mode worth running.
			 */
			expect(calls).toBe(1);

			rerender(<TestComponent />);

			expect(calls).toBe(1);
			expect(result).toBe(expected);

			unmount();
		});

		it("should return the same reference on every render", () => {
			expect.assertions(2);

			const object = { id: 1 };

			function TestComponent() {
				expect(useConstant(() => object)).toBe(object);

				return <></>;
			}

			const { rerender, unmount } = render(<TestComponent />);
			rerender(<TestComponent />);

			unmount();
		});

		it("should keep nested state intact", () => {
			expect.assertions(2);

			const complex = {
				fn: () => "hello",
				nested: {
					array: [1, 2, 3],
					map: new Map([["key", "value"]]),
				},
			};

			function TestComponent() {
				const result = useConstant(() => complex);

				expect(result).toBe(complex);
				expect(result.nested.array).toEqual([1, 2, 3]);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		it("should return a function the caller can invoke", () => {
			expect.assertions(1);

			function TestComponent() {
				const func = useConstant(() => () => 42);

				expect(func()).toBe(42);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();
		});

		/*
		 * A factory with a side effect is a misuse, but `useConstant` accepts one and the only thing
		 * that makes it safe is the same guard the memoization spec covers: the effect runs once, not
		 * once per render.
		 */
		it("should run a side-effecting factory only once", () => {
			expect.assertions(2);

			let sideEffects = 0;

			function TestComponent() {
				const result = useConstant(() => {
					sideEffects += 1;
					return { count: sideEffects };
				});

				expect(result.count).toBe(1);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);

			expect(sideEffects).toBe(1);

			unmount();
		});

		it("should unmount without error", () => {
			expect.assertions(1);

			function TestComponent() {
				useConstant(() => ({ value: "test" }));

				return <></>;
			}

			const { unmount } = render(<TestComponent />);

			expect(() => {
				unmount();
			}).never.toThrow();
		});
	});
});

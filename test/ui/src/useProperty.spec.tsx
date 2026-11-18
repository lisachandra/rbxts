import { describeEachReactMode } from "@lisachandra/test/react";
import { useProperty } from "@lisachandra/ui/hooks/useProperty";
import { describe, expect, it } from "@rbxts/jest-globals";
import * as React from "@rbxts/react";

/*
 * Ported from the godkin repo's `client/ui/hooks/useProperty.spec.tsx` (#17 triage: direct).
 *
 * The upstream spec asserted almost everything from inside the render body and, for its "tracking"
 * case, never actually fired a change event — it asserted `undefined` before and `undefined` after,
 * which passes for a hook that does nothing. What is pinned here instead is the part with a
 * contract: the `Change` object hands the property value back at the slot for that property, and
 * each property gets its own slot.
 *
 * `useProperty`'s declared return type maps over the property tuple in a way roblox-ts cannot
 * destructure cleanly (`InstanceProperties<T, P>` maps keys of the array type rather than its
 * elements). The spec casts the result to a concrete tuple rather than fighting it — the cast is the
 * price of the generic, not a gap in coverage.
 */

interface FrameHandlers {
	AbsoluteSize: (rbx: Frame) => void;
	Position: (rbx: Frame) => void;
}

type TwoPropertyResult = [Vector2 | undefined, UDim2 | undefined, FrameHandlers];

describe("useProperty", () => {
	describeEachReactMode("useProperty (%s)", ({ render }) => {
		it("should return undefined for every value before a change fires", () => {
			expect.assertions(1);

			let size: unknown;

			function TestFrame() {
				const [absoluteSize] = useProperty("Frame", "AbsoluteSize") as [unknown];
				size = absoluteSize;

				return <frame />;
			}

			const { unmount } = render(<TestFrame />);
			unmount();

			expect(size).toBeUndefined();
		});

		it("should return one handler per requested property", () => {
			expect.assertions(3);

			let handlers: undefined | FrameHandlers;

			function TestFrame() {
				const result = useProperty(
					"Frame",
					"AbsoluteSize",
					"Position",
				) as TwoPropertyResult;
				handlers = result[2];

				return <frame Change={handlers} />;
			}

			const { unmount } = render(<TestFrame />);
			unmount();

			expect(handlers).toBeDefined();
			expect(typeIs(handlers!.AbsoluteSize, "function")).toBe(true);
			expect(typeIs(handlers!.Position, "function")).toBe(true);
		});

		it("should place the values in declaration order and the Change object last", () => {
			expect.assertions(4);

			let size: unknown;
			let position: unknown;
			let change: undefined | FrameHandlers;

			function TestFrame() {
				const [absoluteSize, framePosition, event] = useProperty(
					"Frame",
					"AbsoluteSize",
					"Position",
				) as TwoPropertyResult;

				size = absoluteSize;
				position = framePosition;
				change = event;

				return <frame Change={event} />;
			}

			const { unmount } = render(<TestFrame />);
			unmount();

			expect(size).toBeUndefined();
			expect(position).toBeUndefined();
			expect(change!.AbsoluteSize).toBeDefined();
			expect(change!.Position).toBeDefined();
		});

		/*
		 * The one spec that exercises the data path. The hook keys its value table by the property's
		 * index rather than its name, so firing `Position` must land in slot 2 and must not overwrite
		 * the `AbsoluteSize` in slot 1. A name-keyed implementation would pass with one property and
		 * fail here.
		 */
		it("should write each property into its own slot when a change fires", () => {
			expect.assertions(5);

			/*
			 * A fixed table rather than a growing array: roblox-ts types `Array<unknown>.push` as a
			 * `defined[]` method, so pushing a `Vector2 | undefined` is a compile error even though it
			 * is exactly what the first render produces.
			 */
			const snapshots: Array<[Vector2 | undefined, UDim2 | undefined]> = [];
			let fired = false;

			const size = new Vector2(320, 180);
			const position = new UDim2(0, 0, 0.5, 0);

			function TestFrame() {
				const [absoluteSize, framePosition, event] = useProperty(
					"Frame",
					"AbsoluteSize",
					"Position",
				) as TwoPropertyResult;

				snapshots.push([absoluteSize, framePosition]);

				/*
				 * The handlers call `setValues`, so they have to run from inside React's lifecycle for
				 * the update to be scheduled. Firing them from the spec body updates a store that
				 * nothing flushes, which is why the first draft of this spec observed no re-render at
				 * all: an effect is the smallest thing that runs within the committed tree.
				 *
				 * The guard lives inside the effect rather than around it. Wrapping `useEffect` in an
				 * `if` changes the hook count between renders, and React rejects that before any
				 * assertion runs.
				 */
				React.useEffect(() => {
					if (fired) {
						return;
					}

					fired = true;
					const fake = { AbsoluteSize: size, Position: position } as unknown as Frame;
					event.AbsoluteSize(fake);
					event.Position(fake);
				}, []);

				return <frame Change={event} />;
			}

			const { rerender, unmount } = render(<TestFrame />);

			// Give the effect's update a frame to commit.
			rerender(<TestFrame />);

			const first = snapshots[0];
			const latest = snapshots[snapshots.size() - 1];

			unmount();

			expect(first).toBeDefined();
			// The first render had no values yet; that is the empty-state contract.
			expect(first![0]).toBeUndefined();
			expect(latest).toBeDefined();
			expect(latest![0]).toBe(size);
			expect(latest![1]).toBe(position);
		});

		it("should unmount without error", () => {
			expect.assertions(1);

			function TestFrame() {
				const [, event] = useProperty("Frame", "AbsoluteSize") as [unknown, FrameHandlers];

				return <frame Change={event} />;
			}

			const { unmount } = render(<TestFrame />);

			expect(() => {
				unmount();
			}).never.toThrow();
		});
	});
});

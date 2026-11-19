import { describeEachReactMode } from "@lisachandra/test/react";
import { usePropertyBinding } from "@lisachandra/ui/hooks/usePropertyBinding";
import { describe, expect, it } from "@rbxts/jest-globals";
import * as React from "@rbxts/react";

/*
 * Ported from the godkin repo's `client/ui/hooks/usePropertyBinding.spec.tsx` (#17 triage: direct).
 *
 * The sibling of `useProperty`, differing only in what it hands back: bindings instead of values.
 * That means the observable contract is `getValue()`, and the interesting case is not the initial
 * `undefined` but that a fired change reaches the binding — which is what this port adds, because
 * the upstream spec never fired one and so never exercised `bindingSetters[index]`.
 */

interface FrameHandlers {
	AbsoluteSize: (rbx: Frame) => void;
	Position: (rbx: Frame) => void;
}

interface FrameBinding {
	/*
	 * Method syntax, not arrow fields. roblox-ts compiles a method call with the receiver as an
	 * implicit first argument, so `binding:getValue()` reads `self` off the binding's metatable. An
	 * arrow-field declaration makes the compiler treat the receiver as an explicit parameter, the
	 * binding then looks up `[1]` instead of `self`, and the call fails with "attempt to index nil
	 * with userdata" — which is exactly the failure the first draft of this file hit.
	 */
	getValue(): unknown;
	map(mapper: (value: unknown) => unknown): FrameBinding;
}

type TwoBindingResult = [FrameBinding, FrameBinding, FrameHandlers];

describe("usePropertyBinding", () => {
	describeEachReactMode("usePropertyBinding (%s)", ({ render }) => {
		it("should seed every binding with undefined", () => {
			expect.assertions(1);

			let value: unknown;

			function TestFrame() {
				const [sizeBinding] = usePropertyBinding("Frame", "AbsoluteSize") as [FrameBinding];
				value = sizeBinding.getValue();

				return <frame />;
			}

			const { unmount } = render(<TestFrame />);
			unmount();

			expect(value).toBeUndefined();
		});

		it("should return a usable binding per property", () => {
			expect.assertions(6);

			let sizeBinding: undefined | FrameBinding;
			let positionBinding: undefined | FrameBinding;

			function TestFrame() {
				const [size, position, event] = usePropertyBinding(
					"Frame",
					"AbsoluteSize",
					"Position",
				) as TwoBindingResult;

				sizeBinding = size;
				positionBinding = position;

				return <frame Change={event} />;
			}

			const { unmount } = render(<TestFrame />);
			unmount();

			expect(sizeBinding).toBeDefined();
			expect(typeIs(sizeBinding!.getValue, "function")).toBe(true);
			expect(typeIs(sizeBinding!.map, "function")).toBe(true);
			expect(positionBinding).toBeDefined();
			expect(typeIs(positionBinding!.getValue, "function")).toBe(true);
			expect(typeIs(positionBinding!.map, "function")).toBe(true);
		});

		it("should return one handler per requested property", () => {
			expect.assertions(3);

			let handlers: undefined | FrameHandlers;

			function TestFrame() {
				const result = usePropertyBinding(
					"Frame",
					"AbsoluteSize",
					"Position",
				) as TwoBindingResult;
				handlers = result[2];

				return <frame Change={handlers} />;
			}

			const { unmount } = render(<TestFrame />);
			unmount();

			expect(handlers).toBeDefined();
			expect(typeIs(handlers!.AbsoluteSize, "function")).toBe(true);
			expect(typeIs(handlers!.Position, "function")).toBe(true);
		});

		/*
		 * The hook builds its bindings once per distinct set of property names, and this spec pins
		 * that.
		 *
		 * `propertyNames` is a rest parameter, so it is a fresh table on each call. Listing it
		 * directly as a `useMemo` dependency never compares equal, so the memo never hits,
		 * `createBinding` runs again every render, and the element keeps a binding nothing writes to:
		 * a change lands in the binding from the render that supplied the handler and nowhere else
		 * (#75). Spreading the names into the dependency list compares them element by element, which
		 * is what makes a fixed call site reuse one binding per property.
		 */
		it("should keep the same bindings across renders", () => {
			expect.assertions(2);

			const identities = new Array<FrameBinding>();

			function TestFrame() {
				const [binding] = usePropertyBinding("Frame", "AbsoluteSize") as [FrameBinding];
				identities.push(binding);

				return <frame />;
			}

			const { rerender, unmount } = render(<TestFrame />);
			rerender(<TestFrame />);

			unmount();

			expect(identities.size()).toBeGreaterThanOrEqual(2);

			// The same object: the second render reused the first render's binding.
			expect(identities[identities.size() - 1]).toBe(identities[0]);
		});

		/*
		 * The consequence of the stable binding, and the behaviour the user actually sees: a value
		 * written through the `Change` handler is observed by the element, even when the handler and
		 * the binding are read from different renders.
		 */
		it("should route a change through the handler into the binding the element holds", () => {
			expect.assertions(2);

			let fired = false;
			let latestBinding: undefined | FrameBinding;

			const size = new Vector2(320, 180);

			function TestFrame() {
				const [sizeBinding, , event] = usePropertyBinding(
					"Frame",
					"AbsoluteSize",
					"Position",
				) as TwoBindingResult;

				latestBinding = sizeBinding;

				React.useEffect(() => {
					if (fired) {
						return;
					}

					fired = true;
					const fake = { AbsoluteSize: size, Position: new UDim2() } as unknown as Frame;
					event.AbsoluteSize(fake);
				}, []);

				return <frame Change={event} />;
			}

			const { rerender, unmount } = render(<TestFrame />);
			rerender(<TestFrame />);

			unmount();

			expect(fired).toBe(true);

			/*
			 * Read the latest binding, after the rerender — the one the element is actually subscribed
			 * to. With the old rebuild-per-render behaviour this read answered `undefined`.
			 */
			expect(latestBinding!.getValue()).toBe(size);
		});

		it("should accept any creatable instance class", () => {
			expect.assertions(1);

			/*
			 * The generic is over `CreatableInstances`, so this is the compile-time claim made visible:
			 * a `TextButton` has none of a `Frame`'s properties, and the call still typechecks.
			 */
			function TestTypes() {
				usePropertyBinding("TextButton", "Text", "TextColor3", "TextSize");
			}

			expect(TestTypes).toBeDefined();
		});

		it("should unmount without error", () => {
			expect.assertions(1);

			function TestFrame() {
				const [, event] = usePropertyBinding("Frame", "AbsoluteSize") as [
					FrameBinding,
					FrameHandlers,
				];

				return <frame Change={event} />;
			}

			const { unmount } = render(<TestFrame />);

			expect(() => {
				unmount();
			}).never.toThrow();
		});
	});
});

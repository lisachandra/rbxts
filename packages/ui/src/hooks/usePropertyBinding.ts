import type { Binding, InstanceChangeEvent } from "@rbxts/react";
import { createBinding, useMemo } from "@rbxts/react";

import type { InstancePropertyBindings } from "./useProperty";

/**
 * Tracks the state of multiple properties on an Instance and returns property bindings plus a
 * Change object that can be spread into the `Change` property of an element.
 */
export function usePropertyBinding<
	T extends CreatableInstances[I],
	I extends keyof CreatableInstances,
	P extends Array<InstancePropertyNames<T>>,
>(
	classname: I,
	...propertyNames: P
): [...properties: InstancePropertyBindings<T, P>, event: InstanceChangeEvent<T>] {
	const _c = classname;
	const [bindings, bindingSetters] = useMemo(() => {
		const accumulator = [
			[] as Array<Binding<unknown>>, // bindings
			[] as Array<(value: unknown) => void>, // setBindings
		] as const;

		for (const index of $range(0, propertyNames.size() - 1)) {
			const [binding, setBinding] = createBinding<unknown>(undefined);
			accumulator[0][index] = binding;
			accumulator[1][index] = setBinding;
		}

		return accumulator;
	}, [propertyNames]);

	const events = useMemo(() => {
		return propertyNames.reduce<InstanceChangeEvent<T>>((accumulator, property, index) => {
			accumulator[property] = (rbx: T) => {
				bindingSetters[index]!(rbx[property]);
			};

			return accumulator;
		}, {});
	}, [bindingSetters, propertyNames]);

	return useMemo(() => {
		const results = table.clone<Array<unknown>>(bindings);
		results[propertyNames.size()] = events;
		return results as [...InstancePropertyBindings<T, P>, InstanceChangeEvent<T>];
	}, [bindings, events, propertyNames]);
}

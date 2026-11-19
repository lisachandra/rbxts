import type { Binding, InstanceChangeEvent } from "@rbxts/react";
import { createBinding, useMemo } from "@rbxts/react";

import type { InstancePropertyBindings } from "./useProperty";

/**
 * Tracks the state of multiple properties on an Instance and returns property bindings plus a
 * Change object that can be spread into the `Change` property of an element.
 *
 * @remarks
 *   The bindings are built once per distinct set of property names, not once per render. Every
 *   dependency list below spreads the rest parameter (`[...propertyNames]`) instead of passing the
 *   array itself: a rest parameter is a fresh table on every call, so listing it directly never
 *   compares equal, the memo never hits, and `createBinding` runs again each render. That stranded
 *   each `Change` handler on the setters from its own render while the element kept the previous
 *   binding, so a change appeared to do nothing (#75).
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
	const propertyCount = propertyNames.size();

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
	}, [...propertyNames]);

	const events = useMemo(() => {
		return propertyNames.reduce<InstanceChangeEvent<T>>((accumulator, property, index) => {
			accumulator[property] = (rbx: T) => {
				bindingSetters[index]!(rbx[property]);
			};

			return accumulator;
		}, {});
	}, [bindingSetters, ...propertyNames]);

	return useMemo(() => {
		const results = table.clone<Array<unknown>>(bindings);
		results[propertyCount] = events;
		return results as [...InstancePropertyBindings<T, P>, InstanceChangeEvent<T>];
	}, [bindings, events, propertyCount]);
}

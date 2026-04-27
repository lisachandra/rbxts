import type { Binding, InstanceChangeEvent } from "@rbxts/react";
import { useMemo, useState } from "@rbxts/react";

export type InstanceProperties<T extends Instance, P extends Array<InstancePropertyNames<T>>> = {
	[K in keyof P]: T[P[K]];
};
export type InstancePropertyBindings<
	T extends Instance,
	P extends Array<InstancePropertyNames<T>>,
> = {
	[K in keyof P]: Binding<T[P[K]]>;
};

/**
 * Tracks the state of multiple properties on an Instance.
 * Returns the values and a Change object that can be spread into the `Change`
 * property of an element.
 */
export function useProperty<
	T extends CreatableInstances[I],
	I extends keyof CreatableInstances,
	P extends Array<InstancePropertyNames<T>>,
>(
	classname: I,
	...propertyNames: P
): [...properties: InstanceProperties<T, P>, event: InstanceChangeEvent<T>] {
	const _c = classname;
	const [values, setValues] = useState<InstanceProperties<T, P>>({} as InstanceProperties<T, P>);

	const events = useMemo(() => {
		return propertyNames.reduce<InstanceChangeEvent<T>>((accumulator, property, index) => {
			accumulator[property] = (rbx: T) => {
				setValues((previousValues) => {
					const update = table.clone<InstanceProperties<T, P>>(previousValues);
					update[index] = rbx[property];
					return update;
				});
			};

			return accumulator;
		}, {});
	}, [propertyNames]);

	return useMemo(() => {
		const results = table.clone<Array<unknown>>(values);
		results[propertyNames.size()] = events;
		return results as [...InstanceProperties<T, P>, InstanceChangeEvent<T>];
	}, [values, propertyNames, events]);
}

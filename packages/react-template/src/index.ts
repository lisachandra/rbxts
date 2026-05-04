import Log from "@rbxts/log";
import type { ReactNode, JSX } from "@rbxts/react";
import React, { createElement, forwardRef, memo, useEffect, useState } from "@rbxts/react";
import { RunService } from "@rbxts/services";

import { ApiDump } from "./apiDump";

type Table = Record<number | string | symbol, unknown>;

/**
 * Represents a deferred fetch value that can be resolved later with
 * additional properties.
 *
 * @typeParam T - The type of the value to resolve.
 */
// Type representing a fetch value and its associated properties
export interface FetchValue<T> {
	[fetchSymbol]: (value: T) => unknown;
	properties: Array<string>;
}

// Extended instance attributes to include fetch values
/**
 * Maps Roblox instance attributes to fetch values, allowing each
 * attribute to be provided as a deferred {@link FetchValue}.
 *
 * @typeParam T - The Roblox `Instance` subclass.
 *
 * @remarks
 * Each key that exists in `React.InstanceAttributes<T>` may be assigned
 * either the original attribute type or a `FetchValue` that resolves to
 * that type.
 */
export type ExtendedInstanceAttributes<T extends Instance> = {
	[P in keyof React.InstanceAttributes<T>]: FetchValue<any> | React.InstanceAttributes<T>[P];
};

// Extended instance props to include additional properties like key, ref, children, events, and tags
/**
 * Augments instance attributes with optional React and Roblox metadata
 * (`key`, `ref`, `children`, `Event`, `Change`, `Tag`).
 *
 * @typeParam T - The Roblox `Instance` subclass.
 */
export type ExtendedInstanceProps<T extends Instance> = ExtendedInstanceAttributes<T> & {
	Change?: React.InstanceChangeEvent<T>;
	Event?: React.InstanceEvent<T>;
	Tag?: string;

	children?: React.ReactNode;
	key?: React.Key;
	ref?: React.Ref<T>;
};

// Template props that include children and extended instance props
/**
 * Template properties that recursively map Roblox instance properties
 * to nested template props when the property type is an `Instance`.
 *
 * @typeParam T - The Roblox `Instance` subclass.
 *
 * @remarks
 * Children declared via the `childrenSymbol` key are also accepted and
 * flattened into the template's render output.
 */
export type TemplateProps<T extends Instance> = ExtendedInstanceProps<T> & {
	[childrenSymbol]?: ExcludeMembers<
		{
			[K in keyof T]?: T[K] extends infer I
				? I extends Instance
					? TemplateProps<I>
					: never
				: never;
		},
		never
	>;
};

const fetchSymbol: unique symbol = table.freeze({}) as never;
const childrenSymbol = "templateChildren";

/* Merge two tables, optionally excluding values equal to 'none'. */
function merge<A, B, C>(into: A, from: B, none?: C): Exclude<UnionToIntersection<A & B>, C> {
	// Create a new table by merging 'from' into 'into'
	const newTable = { ...into } as Table;

	// pairs over the 'from' table and add its key-value pairs to the new table
	for (const [key, value] of pairs(from as object)) {
		const newValue = value === none ? undefined : value;
		newTable[key as string] = newValue;
	}

	return newTable as unknown as Exclude<UnionToIntersection<A & B>, C>;
}

function is<T>(typed: unknown): typed is T {
	return true;
}

/*
 * Recursively fetches properties from an instance based on its class hierarchy
 * in the API dump.
 */
function fetchProperties<T extends Instance>(
	container: TemplateProps<T>,
	className: T["ClassName"],
	instance: T,
): TemplateProps<T> {
	for (const apiClass of ApiDump.Classes) {
		if (apiClass.Name !== className) {
			continue;
		}

		for (const apiProperty of apiClass.Members) {
			// Set the key if the property is "Name"
			if (apiProperty === "Name" || apiProperty === "Parent") {
				if (apiProperty === "Name") {
					container.key = instance.Name;
				}

				continue;
			}

			container[apiProperty as never] = instance[apiProperty as never];
		}
	}

	return container;
}

function processChild(
	key: string,
	child: Table | typeof React.None,
	defaultChildren: Record<string, React.FunctionComponent<TemplateProps<Instance>>>,
): Table | ReactNode | typeof React.None {
	return child === React.None || "$$typeof" in child
		? child
		: createElement(defaultChildren[key]!, child as never);
}

function processChildrenProps<T extends Instance>(
	props: TemplateProps<T>,
	propertyChildren: Record<string, Table>,
	defaultChildren: Record<string, React.FunctionComponent<TemplateProps<Instance>>>,
): TemplateProps<T> {
	delete props[childrenSymbol];

	for (const [key, child] of pairs(propertyChildren)) {
		propertyChildren[key] = processChild(
			key,
			typeIs(child, "table") ? child : {},
			defaultChildren,
		) as never;
	}

	// Handle direct children
	if (typeIs(props.children, "table")) {
		if ("$$typeof" in props.children) {
			propertyChildren[`${math.random()}`] = props.children;
		} else {
			for (const [key, child] of props.children as never as Map<string, unknown>) {
				propertyChildren[key] = processChild(
					key,
					(typeIs(child, "table") ? child : {}) as Table,
					defaultChildren,
				) as never;
			}
		}
	}

	return props;
}

function processFetchProps<T extends Instance>(
	props: TemplateProps<T>,
	defaultProps: TemplateProps<T>,
): TemplateProps<T> {
	// Compute fetch properties
	for (const [key, property] of pairs(props)) {
		if (
			!typeIs(property, "table") ||
			!(fetchSymbol in property) ||
			!is<FetchValue<T>>(property)
		) {
			continue;
		}

		const properties: Array<defined> = [];

		if (!property.properties.isEmpty()) {
			for (const propertyKey of property.properties as Array<keyof TemplateProps<T>>) {
				properties.push(defaultProps[propertyKey] as never);
			}
		} else {
			properties[0] = defaultProps[key as never];
		}

		props[key as never] = (property[fetchSymbol] as (...value: Array<unknown>) => unknown)(
			...properties,
		) as never;
	}

	return props;
}

function processProps<T extends Instance>(
	props: TemplateProps<T>,
	defaultProps: TemplateProps<T>,
	propertyChildren: Record<string, Table>,
	children: Record<string, React.ReactNode>,
): TemplateProps<T> {
	props.children = merge(children, propertyChildren, React.None);
	return merge(defaultProps, props, React.None) as never;
}

function watchForPropertyChanges<T extends Instance>(
	instance: T,
	defaultProps: TemplateProps<T>,
): void {
	const [_, render] = useState({});

	useEffect(() => {
		// Set up change listener for instance properties
		const connection = (instance as ChangedSignal & typeof instance).Changed.Connect(
			(property: string | keyof WritableInstanceProperties<T>) => {
				if (defaultProps[property as never]) {
					return;
				}

				Log.Debug(
					`${instance.GetFullName().sub("ReplicatedStorage.UI.".size())}.${property as string} = ${instance[property as keyof WritableInstanceProperties<T>]}`,
				);

				defaultProps[property as never] = instance[
					property as keyof WritableInstanceProperties<T>
				] as never;

				render({});
			},
		);

		return () => {
			connection.Disconnect();
		};
	}, []);
}

/**
 * ReactTemplate object for creating and managing React components from Roblox
 * instances.
 */
const ReactTemplate = {
	/**
	 * Unique symbol used to identify fetch-value tables produced by
	 * {@link ReactTemplate.fetch}.
	 */
	_fetch: fetchSymbol,
	/**
	 * Internal registry of template display names. Populated in Studio
	 * to aid debugging and recognition of generated components.
	 */
	_templates: [] as Array<string>,

	/**
	 * Property key (`"templateChildren"`) for declaring named child
	 * templates inside a template's props.
	 */
	children: childrenSymbol,

	/**
	 * Creates a fetch value object.
	 *
	 * @param resolve - The resolve function.
	 * @param properties - The properties to fetch.
	 * @returns - The fetch value object.
	 */
	fetch: <T>(resolve: (value: T) => unknown, ...properties: Array<string>): FetchValue<T> => {
		return {
			[fetchSymbol]: resolve,
			properties,
		};
	},

	/**
	 * Creates a React component from an instance.
	 *
	 * @param instance - The instance to create the component from.
	 * @param fragment - Whether to create a fragment component.
	 * @returns - The React component.
	 */
	fromInstance: <T extends Instance>(
		instance: T,
		fragment = false,
	): React.FunctionComponent<TemplateProps<T>> => {
		const defaultProps = fetchProperties({} as TemplateProps<T>, instance.ClassName, instance);
		const defaultChildren: Record<
			string,
			React.FunctionComponent<TemplateProps<Instance>>
		> = {};

		const instanceChildren = instance.GetChildren();
		const children: Record<string, React.ReactNode> = {};

		for (const child of instanceChildren) {
			defaultChildren[child.Name] = ReactTemplate.fromInstance(child);
		}

		for (const [key, element] of pairs(defaultChildren)) {
			children[key] = createElement(element);
		}

		function TemplateElement(props: TemplateProps<T>, ref?: React.ForwardedRef<T>): JSX.Element {
			const propertyChildren = (
				fragment ? props : (props[childrenSymbol] ?? {})
			) as Record<string, Table>;

			let newProps = props;
			newProps = processChildrenProps(newProps, propertyChildren, defaultChildren);

			// Render as fragment or as Roblox instance
			if (fragment ?? false) {
				const fragments = merge(
					children,
					propertyChildren,
					React.None,
				) as unknown as Array<React.ReactNode>;
				return createElement(React.Fragment, undefined, ...fragments);
			}

			newProps = processFetchProps(newProps, defaultProps);
			newProps = processProps(newProps, defaultProps, propertyChildren, children);

			if (RunService.IsStudio()) {
				watchForPropertyChanges(instance, defaultProps);
			}

			return createElement(instance.ClassName, {
				...newProps,
				ref,
			});
		}

		const template = memo(forwardRef(TemplateElement))
		if (RunService.IsStudio()) {
			ReactTemplate._templates.push(`${template}`);
		}

		return template as unknown as React.FunctionComponent<TemplateProps<T>>;
	},

	/**
	 * Checks if a template is a React function component.
	 *
	 * @param template - The template to check.
	 * @returns - True if the template is a React function component, false
	 *   otherwise.
	 */
	is: (template: unknown): template is React.FunctionComponent<TemplateProps<Instance>> => {
		return ReactTemplate._templates.includes(`${template}`);
	},
};

export default ReactTemplate;

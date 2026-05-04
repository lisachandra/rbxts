import type { Modding } from "@flamework/core";
import Log from "@rbxts/log";
import { fromEntries } from "@rbxts/object-utils";
import type { HasRest, RestType, SplitRest } from "@rbxts/serio/out/metadata/tuples";
import { t } from "@rbxts/t";

import type { IsLiteral, IsUnion } from "type-fest";

type ArrayMetadata<T extends Array<unknown>> = [T] extends [
	{
		length: number;
	},
]
	? TupleMetadata<T>
	: ListMetadata<T>;

type ListMetadata<T extends Array<unknown>> = ["_list", T] extends [
	keyof T,
	{
		_list?: [infer V];
	},
]
	? ["list", ValidateMetadata<V>]
	: ["list", ValidateMetadata<T[number]>];

type TupleMetadata<T extends Array<unknown>> = ["_tuple", T] extends [
	keyof T,
	{
		_tuple?: [infer V extends Array<unknown>];
	},
]
	? [
			"tuple",
			SplitRest<V> extends infer A
				? {
						[K in keyof A]: ValidateMetadata<A[K]>;
					}
				: never,
			HasRest<V> extends true ? ValidateMetadata<RestType<V>> : undefined,
		]
	: [
			"tuple",
			SplitRest<T> extends infer A
				? {
						[K in keyof A]: ValidateMetadata<A[K]>;
					}
				: never,
			HasRest<T> extends true ? ValidateMetadata<RestType<T>> : undefined,
		];

// prettier-ignore
/**
 * Recursive type-level mapping from a Luau data shape to the Serio-based
 * validation metadata format consumed by {@link createDataStoreValidator}.
 *
 * @typeParam T - The Luau type to encode as validation metadata.
 */
export type ValidateMetadata<T> =
	IsLiteral<T> extends true
	? ["literal", Array<NonNullable<T>>]
	: unknown extends T
	? never
	: undefined extends T
	? ["optional", ValidateMetadata<NonNullable<T>>]
	: [T] extends [boolean]
	? ["bool"]
	: [T] extends [number]
	? ["number"]
	: ["_string", T] extends [keyof T, { _string?: [infer _V] }]
	? ["string", T]
	: [T] extends [string]
	? ["string"]
	: ["_set", T] extends [keyof T, { _set?: [infer V] }]
	? ["set", ValidateMetadata<V>]
	: [T] extends [ReadonlySet<infer V>]
	? ["set", ValidateMetadata<V>, ValidateMetadata<number>]
	: ["_map", T] extends [keyof T, { _map?: [infer K, infer V] }]
	? ["map", ValidateMetadata<K>, ValidateMetadata<V>]
	: [T] extends [ReadonlyMap<infer K, infer V>]
	? ["map", ValidateMetadata<K>, ValidateMetadata<V>]
	: [T] extends [Array<unknown>]
	? ArrayMetadata<T>
	: IsUnion<T> extends true
	? [
		"union",
		Array<T extends infer V ? ValidateMetadata<V> : never>
	]
	: true extends IsNominal<T>
	? never
	: T extends object
	? [
		"object",
		Array<{
			[K in keyof T]-?: [K, ValidateMetadata<T[K]>];
		}[keyof T]>,
	]
	: never;

/**
 * Discriminated union of all possible validation schema nodes produced
 * by {@link ValidateMetadata}.
 */
export type ValidateSchema =
	| ["bool"]
	| ["string"]
	| ["number"]
	| ["set", ValidateSchema]
	| ["list", ValidateSchema]
	| ["literal", Array<defined>]
	| ["optional", ValidateSchema]
	| ["map", ValidateSchema, ValidateSchema]
	| ["union", Array<[unknown, ValidateSchema]>]
	| ["object", Array<[string, ValidateSchema]>]
	| ["tuple", Array<ValidateSchema>, ValidateSchema];

/* eslint-disable jsdoc/require-param-description -- Flamework macro */
/**
 * Creates a `t.check` validator function for a specific type.
 *
 * @param meta
 * @metadata macro
 */
export function createDataStoreValidator<T>(meta?: Modding.Many<ValidateMetadata<T>>): t.check<T> {
	const schema = meta as ValidateSchema;
	let validator: t.check<any> = undefined as never; // type-coverage:ignore-line;

	switch (schema[0]) {
		case "bool": {
			validator = t.boolean;

			break;
		}
		case "list": {
			const [_, elementSchema] = schema;
			validator = t.array(createDataStoreValidator(elementSchema as never));

			break;
		}
		case "literal": {
			const [_, literals] = schema;
			validator = t.literalList(literals);

			break;
		}
		case "map": {
			const [_, keySchema, valueSchema] = schema;
			validator = t.map(
				createDataStoreValidator(keySchema as never),
				createDataStoreValidator(valueSchema as never),
			);

			break;
		}
		case "number": {
			validator = t.number;

			break;
		}
		case "object": {
			const [_, fields] = schema;
			validator = t.interface(
				fromEntries(
					fields.map(([fieldName, fieldSchema]) => {
						return [fieldName, createDataStoreValidator(fieldSchema as never)] as const;
					}),
				),
			);

			break;
		}
		case "optional": {
			const [_, valueSchema] = schema;
			validator = t.optional(createDataStoreValidator(valueSchema as never));

			break;
		}
		case "set": {
			const [_, valueSchema] = schema;
			validator = t.set(createDataStoreValidator(valueSchema as never));

			break;
		}
		case "string": {
			validator = t.string;
			break;
		}
		case "tuple": {
			const [_, elements] = schema;
			validator = t.strictArray(
				...elements.map((valueSchema) => createDataStoreValidator(valueSchema as never)),
			);

			break;
		}
		case "union": {
			const [_, elements] = schema;
			validator = t.union(
				...elements.map((valueSchema) => createDataStoreValidator(valueSchema as never)),
			);

			break;
		}
		default: {
			Log.Error(
				`[validateDataStoreSchema]: Cannot serialize unknown schema type '${schema[0]}'`,
			);
		}
	}

	return validator as t.check<T>;
}
/* eslint-enable jsdoc/require-param-description */

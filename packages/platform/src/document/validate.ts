import type { Modding } from "@flamework/core";
import { Boba } from "@rbxts/boba";
import Log from "@rbxts/log";
import { fromEntries } from "@rbxts/object-utils";
import type { HasRest, RestType, SplitRest } from "@rbxts/serio/metadata/tuples";

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

// oxfmt-ignore
/**
 * Recursive type-level mapping from a Luau data shape to the Serio-based validation metadata format
 * consumed by {@link createDataStoreValidator}.
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
	: ["_string", T] extends [keyof T, { _string?: infer _V }]
	? ["map", ["string"], ValidateMetadata<// @ts-expect-error: indexing a mapped type by string cannot be proven valid from this constraint
		T[string]>]
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
	: [T] extends [ReadonlyArray<infer V>]
	? ["list", ValidateMetadata<V>]
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

/** Discriminated union of all possible validation schema nodes produced by {@link ValidateMetadata}. */
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

function wrapBobaValidator<T>(b: Boba<T>): (x: unknown) => asserts x is T {
	return (x: unknown): asserts x is T => {
		return b.assert(x);
	};
}

/* eslint-disable jsdoc/require-param-description -- Flamework macro */
/**
 * Creates a `Boba` const v function for a specific type.
 *
 * @param meta
 * @metadata macro
 */
export function createDataStoreValidator<T, A extends boolean>(
	raw?: A,
	meta?: Modding.Many<ValidateMetadata<T>>,
): A extends true ? Boba<T> : (x: unknown) => asserts x is T {
	const schema = meta as ValidateSchema;
	let validator: Boba<T> | ((x: unknown) => asserts x is T) = undefined as never;

	switch (schema[0]) {
		case "bool": {
			const v = Boba.Boolean as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "list": {
			const [_, elementSchema] = schema;
			const v = Boba.Array(createDataStoreValidator(true, elementSchema as never)) as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "literal": {
			const [_, literals] = schema;
			let v: Boba<T> = undefined as never;
			for (const value of literals) {
				v = (v !== undefined ? v.Or(Boba.Literal(value)) : Boba.Literal(value)) as Boba<T>;
			}

			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "map": {
			const [_, keySchema, valueSchema] = schema;
			const v = Boba.Map(
				createDataStoreValidator(true, keySchema as never),
				createDataStoreValidator(true, valueSchema as never),
			) as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "number": {
			const v = Boba.Number as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "object": {
			const [_, fields] = schema;
			const v = Boba.Struct(
				fromEntries(
					fields.map(([fieldName, fieldSchema]) => {
						return [
							fieldName,
							createDataStoreValidator(true, fieldSchema as never),
						] as const;
					}),
				),
			) as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "optional": {
			const [_, valueSchema] = schema;
			const v = createDataStoreValidator(true, valueSchema as never).Optional() as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "set": {
			const [_, valueSchema] = schema;
			const v = Boba.Set(createDataStoreValidator(true, valueSchema as never)) as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "string": {
			const v = Boba.String as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "tuple": {
			const [_, elements] = schema;
			let index = 0;
			const v = Boba.ExhaustiveStruct(
				fromEntries(
					elements.map(([, tupleSchema]) => {
						index++;
						return [
							index,
							createDataStoreValidator(true, tupleSchema as never),
						] as const;
					}),
				),
			) as Boba<T>;
			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		case "union": {
			const [_, elements] = schema;
			let v: Boba<T> = undefined as never;
			for (const valueSchema of elements) {
				const value = createDataStoreValidator(true, valueSchema as never);
				v = (v !== undefined ? v.Or(value) : value) as Boba<T>;
			}

			validator = raw ? v : wrapBobaValidator(v);

			break;
		}
		default: {
			Log.Error(
				`[validateDataStoreSchema]: Cannot serialize unknown schema type '${schema[0]}'`,
			);
		}
	}

	return validator as A extends true ? Boba<T> : (x: unknown) => asserts x is T;
}
/* eslint-enable jsdoc/require-param-description */

/*
 * This module defines serdes (serialization/deserialization) functions for
 * items. It leverages Squash for defining the structure and types of the data.
 */

import type { Serializer } from "@rbxts/serio";

import type { Items } from "./definitions";
import type { PascalCaseKeys } from "./types";

// A recursive type for defining serdes for nested objects.
type Serdes<T> = T extends object
	? { [K in PascalCaseKeys<T>]: Partial<Serdes<T[K]>> & { serdes: Serializer<any> } } // type-coverage:ignore-line
	: never;

// Serdes definitions for different item types.
/**
 * Stores serialization/deserialization functions for each item type in the
 * hierarchy.
 *
 * @remarks
 * Populated by `defineItems`. Each entry maps to an object containing a
 * `serdes` property — a Serio serializer/deserializer that defines which
 * data fields are replicated over the network.
 */
export const serdes = {} satisfies Partial<Serdes<Items>>;

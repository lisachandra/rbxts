import type { Modding } from "@flamework/core";
import type { AnyEntity, Component } from "@rbxts/matter";
import type { OptionalKeys } from "@rbxts/matter/lib/component";
import createSerializer, {
	type Serializer,
	type SerializerMetadata,
	type StripMeta,
} from "@rbxts/serio";

import type { ChangeRecord } from "../components";

/**
 * Extracts the keys common to both a component map and a replication map.
 *
 * @remarks
 *   Used to constrain replication registrations to only components that are present in both the
 *   world's component definitions and the replication set.
 */
export type ReplicationComponentKey<TComponents, TReplication> = keyof TComponents &
	keyof TReplication;

/**
 * Represents a runtime type guard.
 *
 * @typeParam T - The guarded value type.
 * @param value - The value to validate.
 * @returns Whether the value matches `T`.
 */
export type Guard<T = unknown> = (value: unknown) => value is T;

/**
 * Describes Flamework-generated replication metadata for a codec registration.
 *
 * @typeParam TComponent - The replicated component type.
 * @typeParam TPayload - The serialized payload type.
 */
export interface ReplicationCodecMetadata<
	TComponent extends object = object,
	TPayload extends object = object,
> {
	readonly componentGuard: Modding.Generic<StripMeta<TComponent>, "guard">;
	readonly payload: {
		readonly guard: Modding.Generic<StripMeta<TPayload>, "guard">;
		readonly serializerMetadata: SerializerMetadata<TPayload>;
	};
}

/**
 * Serializes a component change record into a payload for network replication.
 *
 * @typeParam TComponent - The component type being serialized.
 * @typeParam TPayload - The payload type to serialize into.
 * @param record - The change record containing old and new component values.
 * @param playerEntityId - The entity ID of the player receiving the payload.
 * @param componentEntityId - The entity ID of the component being replicated.
 * @param isLocalComponent - Whether this component is local to the player.
 * @param hasReceivedPayload - Whether the client has already received a payload.
 * @returns The serialized payload, or `false` to skip replication, `undefined` to remove component.
 */
export type ServerSerializerFn<
	TComponent extends object = object,
	TPayload extends object = object,
> = (
	record: ChangeRecord<TComponent>,
	playerEntityId: AnyEntity,
	componentEntityId: AnyEntity,
	isLocalComponent: boolean,
	hasReceivedPayload: boolean,
) => false | TPayload | undefined;

/**
 * Deserializes a network payload back into component data on the client.
 *
 * @typeParam TComponent - The component type being deserialized.
 * @typeParam TPayload - The payload type to deserialize from.
 * @param data - The payload data received from the server.
 * @param serverEntityId - The entity ID on the server.
 * @param clientEntityId - The optional corresponding entity ID on the client.
 * @returns A partial component with optional keys, to be merged into the existing component.
 */
export type ClientDeserializerFn<
	TComponent extends object = object,
	TPayload extends object = object,
> = (
	data: TPayload,
	serverEntityId: AnyEntity,
	clientEntityId?: AnyEntity,
) => Partial<OptionalKeys<TComponent>>;

/**
 * Determines which clients receive replication data for a component.
 *
 * @remarks
 *   - `"all"` — Broadcast to every client.
 *   - `"owner"` — Only send to the owning player.
 */
export type ReplicationMode = "all" | "owner";

/**
 * Configuration object for registering a component replication codec.
 *
 * @typeParam TComponent - The component type to replicate.
 * @typeParam TPayload - The serialized payload type.
 */
export interface ReplicationCodecRegistration<
	TComponent extends object = object,
	TPayload extends object = object,
> {
	component: () => Component<TComponent>;
	deserializer: ClientDeserializerFn<TComponent, TPayload>;
	mode?: ReplicationMode;
	serializer: ServerSerializerFn<TComponent, TPayload>;
	unreliable?: boolean;
}

/**
 * A fully resolved replication codec with all defaults applied.
 *
 * @remarks
 *   Extends {@link ReplicationCodecRegistration} with resolved defaults such as `componentKey`,
 *   `payloadSerializer`, generated guards, and `unreliable`.
 * @typeParam TComponent - The component type being replicated.
 * @typeParam TPayload - The serialized payload type.
 */
export interface ReplicationCodec<
	TComponent extends object = object,
	TPayload extends object = object,
> extends ReplicationCodecRegistration<TComponent, TPayload> {
	componentGuard: Guard<TComponent>;
	componentKey: string;
	id: number;
	mode: ReplicationMode;
	payloadGuard: Guard<TPayload>;
	payloadSerializer: Serializer<TPayload>;
	unreliable: boolean;
}

/** A registry that stores and retrieves replication codecs by component key. */
export interface ReplicationCodecRegistry {
	entries(): ReadonlyMap<string, ReplicationCodec<any, any>>;
	get(key: string): undefined | ReplicationCodec<any, any>;
	getById(id: number): undefined | ReplicationCodec<any, any>;
	/** @metadata macro */
	register<TComponent extends object = object, TPayload extends object = object>(
		registration: ReplicationCodecRegistration<TComponent, TPayload>,
		meta?: Modding.Many<ReplicationCodecMetadata<TComponent, TPayload>>,
	): ReplicationCodec<TComponent, TPayload>;
}

/**
 * Creates a new empty replication codec registry.
 *
 * @returns A fresh {@link ReplicationCodecRegistry} instance.
 */
export function createReplicationCodecRegistry(): ReplicationCodecRegistry {
	const codecs = new Map<string, ReplicationCodec<any, any>>();
	const codecsById = new Map<number, ReplicationCodec<any, any>>();
	let nextCodecId = 0;

	return {
		entries() {
			return codecs;
		},
		get(key) {
			return codecs.get(key);
		},
		getById(id) {
			return codecsById.get(id);
		},
		/** @metadata macro */
		register<TComponent extends object = object, TPayload extends object = object>(
			registration: ReplicationCodecRegistration<TComponent, TPayload>,
			meta?: Modding.Many<ReplicationCodecMetadata<TComponent, TPayload>>,
		) {
			assert(meta !== undefined, "Flamework failed to generate replication codec metadata");

			const componentKey = tostring(registration.component);
			const codec = {
				...registration,
				componentGuard: meta.componentGuard,
				componentKey,
				id: nextCodecId,
				mode: registration.mode ?? "all",
				payloadGuard: meta.payload.guard,
				payloadSerializer: createSerializer(meta.payload.serializerMetadata as never),
				unreliable: registration.unreliable ?? false,
			} as ReplicationCodec<TComponent, TPayload>;

			nextCodecId += 1;
			codecs.set(componentKey, codec);
			codecsById.set(codec.id, codec);
			return codec;
		},
	};
}

/**
 * The default singleton replication codec registry.
 *
 * @remarks
 *   All built-in component codecs register against this instance.
 */
export const registry = createReplicationCodecRegistry();

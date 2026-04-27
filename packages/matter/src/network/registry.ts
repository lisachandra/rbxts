import type { Serializer, SerializerMetadata } from "@rbxts/serio";
import createSerializer from "@rbxts/serio";

import type { AnyEntity, Component } from "@rbxts/matter";
import type { ChangeRecord } from "../components";
import { OptionalKeys } from "@rbxts/matter/lib/component";

export type ReplicationComponentKey<TComponents, TReplication> =
	keyof TComponents & keyof TReplication;

export type ServerSerializerFn<
	TComponent extends object = object,
	TPayload extends object = object
> = (
	record: ChangeRecord<TComponent>,
	playerEntityId: AnyEntity,
	componentEntityId: AnyEntity,
	isLocalComponent: boolean,
	hasReceivedPayload: boolean,
) => void | TPayload;

export type ClientDeserializerFn<
	TComponent extends object = object,
	TPayload extends object = object
> = (
	data: TPayload,
	serverEntityId: AnyEntity,
	clientEntityId?: AnyEntity,
) => Partial<OptionalKeys<TComponent>>;

export type ReplicationMode = "all" | "owner";

export interface ReplicationCodecRegistration<
	TComponent extends object = object,
	TPayload extends object = object
> {
	component: () => Component<TComponent>
	deserializer: ClientDeserializerFn<TComponent, TPayload>;
	mode?: ReplicationMode;
	serializer: ServerSerializerFn<TComponent, TPayload>;
	serializerMetadata?: SerializerMetadata<TPayload>;
	unreliable?: boolean;
}

export interface ReplicationCodec<
	TComponent extends object = object,
	TPayload extends object = object
> extends ReplicationCodecRegistration<TComponent, TPayload> {
	componentKey: string;
	mode: ReplicationMode;
	payloadSerializer: Serializer<TPayload>;
	unreliable: boolean;
}

export interface ReplicationCodecRegistry {
	entries(): ReadonlyMap<string, ReplicationCodec<any, any>>;
	get(key: string): ReplicationCodec<any, any> | undefined;
	register<
		TComponent extends object = object,
		TPayload extends object = object
	>(
		serializer: Serializer<TPayload>,
		registration: ReplicationCodecRegistration<TComponent, TPayload>
	): ReplicationCodec<TComponent, TPayload>;
}

export function createReplicationCodecRegistry(): ReplicationCodecRegistry {
	const codecs = new Map<string, ReplicationCodec<any, any>>();

	return {
		entries() {
			return codecs;
		},
		get(key) {
			return codecs.get(key);
		},
		register<
			TComponent extends object = object,
			TPayload extends object = object
		>(
			serializer: Serializer<TPayload>,
			registration: ReplicationCodecRegistration<TComponent, TPayload>
		) {
			const componentKey = tostring(registration.component);
			const codec = {
				...registration,
				componentKey,
				mode: registration.mode ?? "all",
				payloadSerializer: serializer,
				unreliable: registration.unreliable ?? false,
			} as ReplicationCodec<TComponent, TPayload>;

			codecs.set(componentKey, codec);
			return codec
		},
	};
}

export const registry = createReplicationCodecRegistry();

import type { AnyEntity, Component } from "@rbxts/matter";

import type { ChangeRecord, Item } from "../../components";
import { type ComponentKey, Components } from "../../components";
import type {
	ClientDeserializerFn,
	ReplicationCodecRegistration,
	ReplicationMode,
	ServerSerializerFn,
} from "../registry";
import { type CodecStateReader, defaultStateReader } from "../stateReader";
import { itemsDeserializer, itemsSerializer } from "./item";
import type { ItemData } from "./item";

export type { ItemData } from "./item";

/**
 * Builds a client-side deserializer for an item-list component (e.g. {@link Components.Inventory},
 * {@link Components.Hotbar}, or {@link Components.Items}).
 *
 * @remarks
 *   Deserialization preserves existing client items whose GUIDs were not re-sent, merges the
 *   incoming item data, and strips items present in the server's `removedGUIDs` set. When the
 *   client entity does not yet exist in the world, the incoming items are deserialized on their
 *   own.
 * @typeParam TPayload - The network payload shape; must include an `items` array of
 *   {@link ItemData}.
 * @typeParam TComponent - The component shape; must include an `items` array of {@link Item}.
 * @param componentKey - The key of the item-list component to read existing items from.
 * @param extractExtras - Optional hook for decoding additional payload fields into the component.
 * @returns A {@link ClientDeserializerFn} for the component.
 */
export function createItemListDeserializer<
	TPayload extends { items: Array<ItemData> },
	TComponent extends { items: Array<Item> },
>(
	componentKey: ComponentKey,
	extractExtras?: (
		data: TPayload,
		serverEntityId: AnyEntity,
		clientEntityId?: AnyEntity,
	) => Partial<Omit<TComponent, "items">>,
	reader?: CodecStateReader,
): ClientDeserializerFn<TComponent, TPayload> {
	return (data, serverEntityId, clientEntityId) => {
		const stateReader = reader ?? defaultStateReader;
		const entityExists =
			clientEntityId !== undefined &&
			stateReader.getComponent(clientEntityId, componentKey) !== undefined;
		const oldItems = entityExists
			? (
					stateReader.getComponent(clientEntityId!, componentKey) as unknown as {
						items: Array<Item>;
					}
				)?.items
			: undefined;

		const [newItems, removedGUIDs] = itemsDeserializer(data.items, oldItems, stateReader);
		if (oldItems) {
			for (const oldItem of oldItems) {
				const newItem = newItems.find((item) => item.guid === oldItem.guid);
				if (!newItem) {
					newItems.push(oldItem);
				}
			}
		}

		const mergedItems = newItems.filter((item) => !removedGUIDs.includes(item.guid));
		const extras = extractExtras ? extractExtras(data, serverEntityId, clientEntityId) : {};
		return {
			...extras,
			items: mergedItems,
		} as never;
	};
}

/**
 * Builds a server-side serializer for an item-list component.
 *
 * @remarks
 *   The serializer retains the previous replicated items per entity ID in a private dictionary so
 *   each entity's delta is computed against its own prior state. The first replication for an
 *   entity sends the full item list; subsequent replications send only the changes.
 * @typeParam TComponent - The component shape; must include an `items` array of {@link Item}.
 * @typeParam TPayload - The network payload shape; must include an `items` array of
 *   {@link ItemData}.
 * @param buildExtras - Optional hook for encoding additional component fields into the payload.
 * @returns A {@link ServerSerializerFn} for the component.
 */
export function createItemListSerializer<
	TComponent extends { items: Array<Item> },
	TPayload extends { items: Array<ItemData> },
>(
	buildExtras?: (
		record: ChangeRecord<TComponent>,
		playerEntityId: AnyEntity,
		componentEntityId: AnyEntity,
	) => Partial<Omit<TPayload, "items">>,
	reader?: CodecStateReader,
): ServerSerializerFn<TComponent, TPayload> {
	const lastReplicatedItems: Record<string, Array<Item>> = {};

	return (record, playerEntityId, componentEntityId) => {
		const key = `${componentEntityId}`;
		const [items, newReplicatedItems] = itemsSerializer(
			{ new: record.new!.items, old: record.old?.items },
			lastReplicatedItems[key] ?? [],
			reader,
		);
		lastReplicatedItems[key] = newReplicatedItems;

		const extras = buildExtras ? buildExtras(record, playerEntityId, componentEntityId) : {};
		return {
			...extras,
			items,
		} as never;
	};
}

/**
 * Options for building a full {@link ReplicationCodecRegistration} for an item-list component.
 *
 * @typeParam TComponent - The component shape; must include an `items` array of {@link Item}.
 * @typeParam TPayload - The network payload shape; must include an `items` array of
 *   {@link ItemData}.
 */
export interface ItemListCodecOptions<
	TComponent extends { items: Array<Item> },
	TPayload extends { items: Array<ItemData> },
> {
	/** Component constructor used to register the codec. */
	component: () => Component<TComponent>;
	/** Key of the item-list component used to read existing items during deserialization. */
	componentKey: ComponentKey;
	/** Optional hook for decoding additional payload fields into the component. */
	deserializeExtras?: (
		data: TPayload,
		serverEntityId: AnyEntity,
		clientEntityId?: AnyEntity,
	) => Partial<Omit<TComponent, "items">>;
	/** Which clients receive replication data: `"owner"` or `"all"`. */
	mode: ReplicationMode;
	/** Optional state reader seam for tests; defaults to the production store-backed reader. */
	reader?: CodecStateReader;
	/** Optional hook for encoding additional component fields into the payload. */
	serializeExtras?: (
		record: ChangeRecord<TComponent>,
		playerEntityId: AnyEntity,
		componentEntityId: AnyEntity,
	) => Partial<Omit<TPayload, "items">>;
}

/**
 * Produces a complete {@link ReplicationCodecRegistration} for an item-list component, wiring
 * together the unified serializer, deserializer, and replication mode.
 *
 * @remarks
 *   This is not itself a Flamework macro; callers should pass the returned registration directly to
 *   `registry.register<C, P>(...)` at module top level so Flamework generates the payload guards
 *   and Serio metadata.
 * @typeParam TComponent - The component shape; must include an `items` array of {@link Item}.
 * @typeParam TPayload - The network payload shape; must include an `items` array of
 *   {@link ItemData}.
 * @param options - The component key, constructor, mode, and optional extras hooks.
 * @returns A complete registration to hand to `registry.register`.
 */
export function createItemListCodecRegistration<
	TComponent extends { items: Array<Item> },
	TPayload extends { items: Array<ItemData> },
>(
	options: ItemListCodecOptions<TComponent, TPayload>,
): ReplicationCodecRegistration<TComponent, TPayload> {
	return {
		component: options.component,
		deserializer: createItemListDeserializer<TPayload, TComponent>(
			options.componentKey,
			options.deserializeExtras,
			options.reader,
		),
		mode: options.mode,
		serializer: createItemListSerializer<TComponent, TPayload>(
			options.serializeExtras,
			options.reader,
		),
	};
}

import { u16, u32 } from "@rbxts/serio";
import { MessageEmitter } from "@rbxts/tether";

/**
 * The shared message emitter for network communication between server and client.
 *
 * @remarks
 * Uses {@link MessageEmitter} from Tether to provide type-safe message dispatch
 * based on the {@link MessageData} interface.
 */
export const messaging = MessageEmitter.create<MessageData>({ batchRemotes: false });

/**
 * Enumeration of all supported network message types.
 *
 * @remarks
 * Each variant corresponds to a specific network event used during replication.
 */
export const enum Message {
	Loaded,
	Time,
	SpawnEntity,
	DespawnEntity,
	ItemGUIDMap,
	ResyncItem,
	MoveItemTo,
	DropItem,
	Component,
}

/**
 * Maps each {@link Message} variant to its corresponding payload data structure.
 *
 * @remarks
 * Used by the {@link messaging} emitter to enforce type-safe message handling.
 */
export interface MessageData {
	[Message.Loaded]: undefined;
	[Message.Time]: {
		startClock: u32;
		startEpoch: u32;
	};
	[Message.DespawnEntity]: u32;
	[Message.SpawnEntity]: u32;
	[Message.ItemGUIDMap]: Record<string, u16>;
	[Message.ResyncItem]: string;
	[Message.MoveItemTo]: {
		destination: boolean;
		guid: u16;
	};
	[Message.DropItem]: {
		amount: u16;
		guid: u16;
	};
	[Message.Component]: {
		componentId: u16;
		payload?: { blobs?: Array<defined>; buf?: buffer };
		serverEntityId: u32;
	};
}

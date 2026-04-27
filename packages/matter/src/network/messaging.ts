import { u16, u32 } from "@rbxts/serio";
import { MessageEmitter } from "@rbxts/tether";

export const messaging = MessageEmitter.create<MessageData>();

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
		componentKey: string;
		payload?: { blobs?: Array<defined>; buf?: buffer };
		serverEntityId: u32;
	};
}

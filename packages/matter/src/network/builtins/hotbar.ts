import type { u16 } from "@rbxts/serio";
import { flip } from "@rbxts/sift/Dictionary";

import { Components } from "../../components";
import { registry } from "../registry";
import { defaultStateReader } from "../stateReader";
import type { ItemData } from "./item";
import { createItemListCodecRegistration } from "./itemList";

/**
 * Payload structure for replicating the {@link Components.Hotbar} component.
 *
 * @remarks
 *   Includes the hotbar items and an optional equipped item numeric ID.
 */
export interface HotbarPayload {
	equipped?: u16;
	items: Array<ItemData>;
}

registry.register<Components["Hotbar"], HotbarPayload>(
	createItemListCodecRegistration<Components["Hotbar"], HotbarPayload>({
		component: Components.Hotbar,
		componentKey: "Hotbar",
		deserializeExtras: (data, _serverEntityId, _clientEntityId, reader) => ({
			equipped:
				data.equipped !== undefined
					? flip((reader ?? defaultStateReader).getItemGUIDMap())[data.equipped]!
					: undefined,
		}),
		mode: "owner",
		serializeExtras: (record, _playerEntityId, _componentEntityId, reader) => ({
			equipped: (reader ?? defaultStateReader).getItemGUIDMap()[
				(record.old?.equipped !== record.new!.equipped ? record.new!.equipped : undefined)!
			],
		}),
	}),
);

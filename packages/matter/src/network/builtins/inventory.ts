import { Components } from "../../components";
import { registry } from "../registry";
import type { ItemData } from "./item";
import { createItemListCodecRegistration } from "./itemList";

/** Payload structure for replicating the {@link Components.Inventory} component. */
export interface InventoryPayload {
	items: Array<ItemData>;
}

registry.register<Components["Inventory"], InventoryPayload>(
	createItemListCodecRegistration<Components["Inventory"], InventoryPayload>({
		component: Components.Inventory,
		componentKey: "Inventory",
		mode: "owner",
	}),
);

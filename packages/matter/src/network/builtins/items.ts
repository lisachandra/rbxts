import { getInstanceWithAttribute } from "@lisachandra/core/utils/main";
import { Workspace } from "@rbxts/services";

import { Components } from "../../components";
import { registry } from "../registry";
import type { ItemData } from "./item";
import { createItemListCodecRegistration } from "./itemList";

/** Payload structure for replicating the {@link Components.Items} component. */
export interface ItemsPayload {
	items: Array<ItemData>;
}

registry.register<Components["Items"], ItemsPayload>(
	createItemListCodecRegistration<Components["Items"], ItemsPayload>({
		component: Components.Items,
		componentKey: "Items",
		deserializeExtras: (_data, serverEntityId) => ({
			model: getInstanceWithAttribute(
				Workspace.Items.GetChildren(),
				"serverEntityId",
				serverEntityId,
			) as Model,
		}),
		mode: "all",
	}),
);

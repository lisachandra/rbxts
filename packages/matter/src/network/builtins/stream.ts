import { store } from "@lisachandra/core/store";
import { getInstanceWithAttribute } from "@lisachandra/core/utils/main";
import { equalsDeep } from "@rbxts/sift/Dictionary";

import { Components } from "../../components";
import { registry } from "../registry";

/** Payload structure for replicating the {@link Components.Stream} component. */
export interface StreamPayload {
	container: Instance;
}

registry.register<Components["Stream"], StreamPayload>({
	component: Components.Stream,
	deserializer: (data, serverEntityId, clientEntityId) => {
		const world = store.world.contains(clientEntityId!) ? store.world : undefined;
		const value =
			world?.get(clientEntityId!, Components.Stream)?.value ??
			(getInstanceWithAttribute(
				data.container.GetChildren(),
				"serverEntityId",
				serverEntityId,
			) !== undefined
				? "in"
				: "out");

		return {
			container: data.container,
			value,
		};
	},
	mode: "all",
	serializer: (record) =>
		!equalsDeep(record.old ?? {}, record.new ?? {})
			? {
					container: record.new!.container,
				}
			: false,
});

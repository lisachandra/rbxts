import { registry } from "../registry";
import { Components, getComponent } from "../../components";
import { store } from "@lisachandra/core/out/store";
import { getInstanceWithAttribute } from "@lisachandra/core/out/utils/main";
import { equalsDeep } from "@rbxts/sift/out/Dictionary";

/**
 * Payload structure for replicating the {@link Components.Stream} component.
 */
export type StreamPayload = {
	container: Instance
};

registry.register<Components["Stream"], StreamPayload>({
	component: getComponent("Stream"),
	mode: "all",
	serializer: (record) => (
		!equalsDeep(record.old ?? {}, record.new ?? {}) ? {
			container: record.new!.container
		} : false
	),
	deserializer: (data, serverEntityId, clientEntityId) => {
		const world = store.world.contains(clientEntityId!) ? store.world : undefined;
		const value =
			world?.get(clientEntityId!, getComponent("Stream"))?.value ??
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
});

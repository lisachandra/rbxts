import { registry } from "../registry";
import { Components, getComponent } from "../../components";
import createSerializer from "@rbxts/serio";
import { store } from "@lisachandra/core/out/store";
import { getInstanceWithAttribute } from "@lisachandra/core/out/utils/main";

export type StreamPayload = {
	container: Instance
};

registry.register<Components["Stream"], StreamPayload>({
	component: getComponent("Stream"),
	serdes: createSerializer<StreamPayload>(),
	mode: "all",
	serializer: (record) => ({
		container: record.new!.container,
	}),
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

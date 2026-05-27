import { registry } from "../registry";
import { Components, getComponent } from "../../components";
import { getInstanceWithAttribute } from "@lisachandra/core/out/utils/main";
import { u8 } from "@rbxts/serio";
import { Workspace } from "@rbxts/services";
import { equalsDeep } from "@rbxts/sift/out/Dictionary";

/**
 * Payload structure for replicating the {@link Components.Node} component.
 */
export type NodePayload = {
	type: u8,
	model: Instance
};

registry.register<Components["Node"], NodePayload>({
	component: getComponent("Node"),
	mode: "all",
	serializer: (record) => !equalsDeep(record.old ?? {}, record.new ?? {}) ? record.new : false,
	deserializer: (data, serverEntityId) => {
		return {
			type: data.type,
			model: getInstanceWithAttribute(
				Workspace.Nodes.GetChildren(),
				"serverEntityId",
				serverEntityId,
			) as Part,
		}
	},
});

import { getInstanceWithAttribute } from "@lisachandra/core/utils/main";
import type { u8 } from "@rbxts/serio";
import { Workspace } from "@rbxts/services";
import { equalsDeep } from "@rbxts/sift/Dictionary";

import { Components } from "../../components";
import { registry } from "../registry";

/** Payload structure for replicating the {@link Components.Node} component. */
export interface NodePayload {
	type: u8;
	model: Instance;
}

registry.register<Components["Node"], NodePayload>({
	component: Components.Node,
	deserializer: (data, serverEntityId) => {
		return {
			type: data.type,
			model: getInstanceWithAttribute(
				Workspace.Nodes.GetChildren(),
				"serverEntityId",
				serverEntityId,
			) as Part,
		};
	},
	mode: "all",
	serializer: (record) => (!equalsDeep(record.old ?? {}, record.new ?? {}) ? record.new : false),
});

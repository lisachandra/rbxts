import { registry } from "../registry";
import { Components } from "../../components";
import { getInstanceWithAttribute } from "@lisachandra/core/out/utils/main";
import createSerializer, { u8 } from "@rbxts/serio";
import { Workspace } from "@rbxts/services";

export type NodePayload = {
	type: u8,
	model: Instance
};

registry.register<Components.Node, NodePayload>(createSerializer<NodePayload>(), {
	component: Components.Node,
	mode: "all",
	serializer: (record) => record.new!,
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

import { registry } from "../registry";
import { Components } from "../../components";
import { u16 } from "@rbxts/serio";
import { equalsDeep } from "@rbxts/sift/out/Dictionary";

/**
 * Payload structure for replicating the {@link Components.Sound} component.
 */
export type SoundPayload = {
	id: u16
};

registry.register<Components["Sound"], SoundPayload>({
	component: Components.Sound,
	mode: "owner",
	serializer: (record) => !equalsDeep(record.old ?? {}, record.new ?? {}) ? record.new : false,
	deserializer: (data) => data,
});

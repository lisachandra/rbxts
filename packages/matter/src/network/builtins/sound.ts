import type { u16 } from "@rbxts/serio";
import { equalsDeep } from "@rbxts/sift/Dictionary";

import { Components } from "../../components";
import { registry } from "../registry";

/** Payload structure for replicating the {@link Components.Sound} component. */
export interface SoundPayload {
	id: u16;
}

registry.register<Components["Sound"], SoundPayload>({
	component: Components.Sound,
	deserializer: (data) => data,
	mode: "owner",
	serializer: (record) => (!equalsDeep(record.old ?? {}, record.new ?? {}) ? record.new : false),
});

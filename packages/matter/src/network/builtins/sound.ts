import { registry } from "../registry";
import { Components, getComponent } from "../../components";
import { u16 } from "@rbxts/serio";

/**
 * Payload structure for replicating the {@link Components.Sound} component.
 */
export type SoundPayload = {
	id: u16
};

registry.register<Components["Sound"], SoundPayload>({
	component: getComponent("Sound"),
	mode: "owner",
	serializer: (record) => record.new!,
	deserializer: (data) => data,
});

import { registry } from "../registry";
import { Components, getComponent } from "../../components";
import createSerializer, { u16 } from "@rbxts/serio";

export type SoundPayload = {
	id: u16
};

registry.register<Components["Sound"], SoundPayload>({
	component: getComponent("Sound"),
	serdes: createSerializer<SoundPayload>(),
	mode: "owner",
	serializer: (record) => record.new!,
	deserializer: (data) => data,
});

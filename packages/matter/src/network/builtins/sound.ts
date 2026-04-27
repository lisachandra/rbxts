import { registry } from "../registry";
import { Components } from "../../components";
import createSerializer, { u16 } from "@rbxts/serio";

export type SoundPayload = {
	id: u16
};

registry.register<Components.Sound, SoundPayload>(createSerializer<SoundPayload>(), {
	component: Components.Sound,
	mode: "owner",
	serializer: (record) => record.new!,
	deserializer: (data) => data,
});

import { registry } from "../registry";
import { Components, Force } from "../../components";
import createSerializer, { u32 } from "@rbxts/serio";

type ReplaceNumbers<T, Replacement> = { [K in keyof T]: T[K] extends number ? Replacement: T[K] }

export interface ForcesPayload extends Components.Forces {
	forces: Array<{
		force: ReplaceNumbers<Force, u32>
		time: u32
	}>
}

registry.register<Components.Forces, ForcesPayload>(createSerializer<ForcesPayload>(), {
	component: Components.Forces,
	mode: "all",
	serializer: (record) => record.new!,
	deserializer: (data) => data,
});

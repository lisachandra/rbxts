import { registry } from "../registry";
import { Components, Force, getComponent } from "../../components";
import createSerializer, { u32 } from "@rbxts/serio";

type ReplaceNumbers<T, Replacement> = { [K in keyof T]: T[K] extends number ? Replacement: T[K] }

export type ForcesPayload = Omit<Components["Forces"], "forces"> & {
	forces: Array<{
		force: ReplaceNumbers<Force, u32>
		time: u32
	}>
}

registry.register<Components["Forces"], ForcesPayload>({
	component: getComponent("Forces"),
	serdes: createSerializer<ForcesPayload>(),
	mode: "all",
	serializer: (record) => record.new!,
	deserializer: (data) => data,
});

import { registry } from "../registry";
import { Components, Force, getComponent } from "../../components";
import createSerializer, { u32 } from "@rbxts/serio";

type ReplaceNumbers<T, Replacement> = { [K in keyof T]: T[K] extends number ? Replacement: T[K] }

/**
 * Payload structure for replicating the {@link Components.Forces} component.
 *
 * @remarks
 * Numeric fields in {@link Force} are replaced with `u32` for serialization.
 */
export type ForcesPayload = Partial<Omit<Components["Forces"], "forces">> & {
	forces: Array<{
		force: ReplaceNumbers<Force, u32>
		time: u32
	}>
}

registry.register<Components["Forces"], ForcesPayload>({
	component: getComponent("Forces"),
	mode: "all",
	serializer: (record) => record.new!,
	deserializer: (data) => data,
});

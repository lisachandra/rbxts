import type { u32 } from "@rbxts/serio";
import { equalsDeep } from "@rbxts/sift/Dictionary";

import type { Force } from "../../components";
import { Components } from "../../components";
import { registry } from "../registry";

type ReplaceNumbers<T, Replacement> = { [K in keyof T]: T[K] extends number ? Replacement : T[K] };

/**
 * Payload structure for replicating the {@link Components.Forces} component.
 *
 * @remarks
 *   Numeric fields in {@link Force} are replaced with `u32` for serialization.
 */
export type ForcesPayload = Partial<Omit<Components["Forces"], "forces">> & {
	forces: Array<{
		force: ReplaceNumbers<Force, u32>;
		time: u32;
	}>;
};

registry.register<Components["Forces"], ForcesPayload>({
	component: Components.Forces,
	deserializer: (data) => data,
	mode: "all",
	serializer: (record) => (!equalsDeep(record.old ?? {}, record.new ?? {}) ? record.new : false),
});

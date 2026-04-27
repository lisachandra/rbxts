import { Players } from "@rbxts/services";

import { registry } from "../registry";
import { Components } from "../../components";
import { getInstanceWithAttribute } from "@lisachandra/core/out/utils/main";
import createSerializer from "@rbxts/serio";

export type ProfilePayload = {}

registry.register<Components.Profile, ProfilePayload>(createSerializer<ProfilePayload>(), {
	component: Components.Profile,
	mode: "all",
	serializer: (_record) => {},
	deserializer: (_data, serverEntityId) => {
		const player = getInstanceWithAttribute(Players.GetPlayers(), "serverEntityId", serverEntityId);
		assert(player !== undefined, "Replicated player is nil");

		return {
			player,
		};
	},
});

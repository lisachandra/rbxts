import { Players } from "@rbxts/services";

import { registry } from "../registry";
import { Components } from "../../components";
import { getInstanceWithAttribute } from "@lisachandra/core/utils/main";

/**
 * Payload structure for replicating the {@link Components.Profile} component.
 *
 * @remarks
 * The payload is empty because the player instance is resolved on the client
 * via the `serverEntityId` attribute.
 */
export type ProfilePayload = {}

registry.register<Components["Profile"], ProfilePayload>({
	component: Components.Profile,
	mode: "all",
	serializer: (_record) => ({}),
	deserializer: (_data, serverEntityId) => {
		const player = getInstanceWithAttribute(Players.GetPlayers(), "serverEntityId", serverEntityId);
		assert(player !== undefined, "Replicated player is nil");

		return {
			player,
		};
	},
});

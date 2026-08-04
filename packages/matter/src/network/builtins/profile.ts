import { getInstanceWithAttribute } from "@lisachandra/core/utils/main";
import { Players } from "@rbxts/services";

import { Components } from "../../components";
import { registry } from "../registry";

/**
 * Payload structure for replicating the {@link Components.Profile} component.
 *
 * @remarks
 *   The payload is empty because the player instance is resolved on the client via the
 *   `serverEntityId` attribute.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- empty payload sent over the wire
export interface ProfilePayload {}

registry.register<Components["Profile"], ProfilePayload>({
	component: Components.Profile,
	deserializer: (_data, serverEntityId) => {
		const player = getInstanceWithAttribute(
			Players.GetPlayers(),
			"serverEntityId",
			serverEntityId,
		);
		assert(player !== undefined, "Replicated player is nil");

		return {
			player,
		};
	},
	mode: "all",
	serializer: (_record) => ({}),
});

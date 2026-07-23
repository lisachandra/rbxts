/** Command to teleport players to a target player. */
import type { CommandContext } from "@rbxts/centurion";
import { CenturionType, Command, Guard, Register } from "@rbxts/centurion";

import { adminOrDeveloper } from "../guards";
import { getHumanoid } from "@lisachandra/core/utils/main";

@Register()
export class TeleportCommand {
	/**
	 * Teleports a group of players to a target player's location. Handles cases
	 * where the target player's CFrame is invalid.
	 *
	 * @param _ - The command context (unused).
	 * @param from - An array of Player objects to teleport.
	 * @param target - The Player object representing the target destination.
	 */
	@Command({
		aliases: ["tp"],
		description: "Teleports a player or set of players to one target.",
		name: "teleport",
		arguments: [
			{
				type: CenturionType.Players,
				description: "The players to teleport",
				name: "from",
			},
			{
				type: CenturionType.Player,
				description: "The target destination to teleport to.",
				name: "target",
			},
		],
	})
	@Guard(adminOrDeveloper)
	public teleport(_: CommandContext, from: Array<Player>, target: Player): void {
		const cf = getHumanoid(target)?.RootPart?.CFrame;

		// Check if the target's CFrame is valid.  If not, the teleport cannot proceed.
		if (!typeIs(cf, "CFrame")) {
			return;
		}

		for (const player of from) {
			const humanoid = getHumanoid(player);
			const rootPart = humanoid?.RootPart;

			// Force the player to stand up if they are sitting.
			if (humanoid?.Sit === true) {
				humanoid.Jump = true;
			}

			if (rootPart) {
				rootPart.CFrame = cf;
			}
		}
	}
}

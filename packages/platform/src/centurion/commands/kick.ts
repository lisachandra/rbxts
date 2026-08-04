/** Command to kick players from the server. */
import type { CommandContext } from "@rbxts/centurion";
import { CenturionType, Command, Guard, Register } from "@rbxts/centurion";

import { adminOrDeveloper } from "../guards";

@Register()
/** Admin command that kicks one or more players from the server. */
export class KickCommand {
	/**
	 * Kicks the specified players from the server.
	 *
	 * @param _ - The command context (unused).
	 * @param players - An array of Player objects to kick.
	 */
	@Command({
		arguments: [
			{
				type: CenturionType.Players,
				description: "The players to kick.",
				name: "players",
			},
		],
		description: "Kicks players from the server",
		name: "kick",
	})
	@Guard(adminOrDeveloper)
	public kick(_: CommandContext, players: Array<Player>): void {
		for (const player of players) {
			player.Kick("Kicked by admin.");
		}
	}
}

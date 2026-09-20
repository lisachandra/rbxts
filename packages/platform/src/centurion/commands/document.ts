import { catcher, waitForDocument } from "@lisachandra/core/utils/main";
import { formatTable } from "@lisachandra/core/utils/string";
import type { CommandContext } from "@rbxts/centurion";
import { CenturionType, Command, Guard, Register } from "@rbxts/centurion";
import { Players } from "@rbxts/services";

import { adminOrDeveloper } from "../guards";

@Register()
/**
 * Admin command that retrieves document data for a specified player.
 *
 * @remarks
 *   On success the player is kicked (data is reloaded on rejoin). If the player is not in the
 *   server the document is unloaded asynchronously.
 */
export class DocumentCommand {
	@Command({
		arguments: [
			{
				type: CenturionType.Number,
				description: "The user id of the player.",
				name: "user",
			},
		],
		description: "Get document information for a player.",
		name: "document",
	})
	@Guard(adminOrDeveloper)
	/**
	 * Fetches and displays the document associated with a user ID, then kicks the player or unloads
	 * the document.
	 *
	 * @param context - The command context for replying with results.
	 * @param userId - The Roblox user ID whose document to retrieve.
	 */
	public document(context: CommandContext, userId: number): void {
		waitForDocument(userId)
			.then(async (document) => {
				const data = document.get_data();
				context.reply(formatTable(data as Record<string, unknown>, "Long"));

				const player = Players.GetPlayerByUserId(userId);
				if (player !== undefined) {
					player.Kick("Kicked by admin.");
				} else {
					task.defer(() => {
						document.unload();
					});
				}
			})
			.catch(catcher());
	}
}

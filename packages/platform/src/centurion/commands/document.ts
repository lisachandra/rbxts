import type { CommandContext } from "@rbxts/centurion";
import { CenturionType, Command, Guard, Register } from "@rbxts/centurion";
import { Players } from "@rbxts/services";

import { adminOrDeveloper } from "../guards";
import { catcher, waitForDocument } from "@lisachandra/core/out/utils/main";
import { formatTable } from "@lisachandra/core/out/utils/string";

@Register()
/**
 * Admin command that retrieves document data for a specified player.
 *
 * @remarks
 * On success the player is kicked (data is reloaded on rejoin). If the
 * player is not in the server the document is closed asynchronously.
 */
export class DocumentCommand {
	@Command({
		description: "Get document information for a player.",
		name: "document",
		arguments: [
			{
				type: CenturionType.Number,
				description: "The user id of the player.",
				name: "user",
			},
		],
	})
	@Guard(adminOrDeveloper)
	/**
	 * Fetches and displays the document associated with a user ID, then
	 * kicks the player or closes the document.
	 *
	 * @param context - The command context for replying with results.
	 * @param userId - The Roblox user ID whose document to retrieve.
	 */
	public document(context: CommandContext, userId: number): void {
		waitForDocument(userId)
			.then(async (document) => {
				const data = document.read();
				context.reply(formatTable(data, "Long"));

				const player = Players.GetPlayerByUserId(userId);
				if (player !== undefined) {
					player.Kick("Kicked by admin.");
				} else {
					task.defer(() => {
						document.close().await();
					});
				}
			})
			.catch(catcher);
	}
}

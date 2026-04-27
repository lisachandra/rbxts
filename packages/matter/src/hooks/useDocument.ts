import { CollectionData, store } from "@lisachandra/core/out/store";
import { Collection, Document } from "@rbxts/lapis";
import Log from "@rbxts/log";
import { None } from "@rbxts/sift";

/**
 * A hook that retrieves a Lapis Document for a given player. Handles loading
 * and caching of documents.
 *
 * @param userId - The userId of the player.
 * @param player - The Player instance (optional). If provided, used for name
 *   logging and kicking in case of document load failure.
 * @returns An object containing the document (if loaded) and the discriminator
 *   string used to identify the document.
 * @server
 */
export function useDocument(
	collection: Collection<any, any>,
	userId: number,
	player?: Player,
): { discriminator: string; document?: Document<CollectionData> } {
	const name = player ? player.Name : `${userId}`;
	const discriminator = `Player_${userId}`;

	if (!(discriminator in store.documents)) {
		Log.Info(`loading document for Player: ${name}`);
		store.documents[discriminator] = None as never;

		collection
			.load(`Player_${userId}`, [userId])
			.then(async (document) => {
				if (!player?.Parent) {
					document.close().await();
					return;
				}

				Log.Info(`document loaded for Player: ${name}`);
				store.documents[discriminator] = document;

				document.beforeClose(() => {
					delete store.documents[discriminator];
					store.server
						.update({
							documents: (documents) => {
								delete documents[discriminator];
								return documents;
							},
						})
						.await();
				});
			})
			.catch((err: unknown) => {
				Log.Warn(`Document failed to load for Player: ${name} (${err})`);
				player?.Kick("Document failed to load, please rejoin");
			});
	}

	const document =
		store.documents[discriminator] === (None as never) ? undefined : store.documents[discriminator];

	return {
		discriminator,
		document,
	};
}

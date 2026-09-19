import type { CollectionData } from "@lisachandra/core/store";
import { store } from "@lisachandra/core/store";
import type { Profile, Store } from "@rbxts/dataforge";
import Log from "@rbxts/log";
import { None } from "@rbxts/sift";

/**
 * A hook that retrieves a Dataforge Profile for a given player. Handles loading and caching of
 * player documents in the shared store.
 *
 * @param dataStore - The Dataforge store to load profiles from.
 * @param userId - The userId of the player.
 * @param player - The Player instance (optional). If provided, used for name logging and kicking in
 *   case of document load failure.
 * @returns An object containing the profile (if loaded) and the discriminator string used to
 *   identify the document.
 * @server
 */
export function useDocument(
	dataStore: Store<CollectionData>,
	userId: number,
	player?: Player,
): { discriminator: string; document?: Profile<CollectionData> } {
	const name = player ? player.Name : `${userId}`;
	const discriminator = `Player_${userId}`;

	if (!(discriminator in store.documents)) {
		Log.Info(`loading document for Player: ${name}`);
		store.documents[discriminator] = None as never;

		Promise.defer<Profile<CollectionData>>((resolve) => {
			resolve(dataStore.load(discriminator, [userId]));
		})
			.then((profile) => {
				if (!player?.Parent) {
					profile.unload();
					return;
				}

				Log.Info(`document loaded for Player: ${name}`);
				store.documents[discriminator] = profile;

				profile.on_closed(() => {
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
		store.documents[discriminator] === (None as never)
			? undefined
			: store.documents[discriminator];

	return {
		discriminator,
		document,
	};
}

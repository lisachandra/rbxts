import type { CollectionData } from "@lisachandra/core/store";
import { store } from "@lisachandra/core/store";
import type { Profile, Store } from "@rbxts/dataforge";
import Log from "@rbxts/log";
import { None } from "@rbxts/sift";

/**
 * Failed loads a discriminator gets before the hook stops trying and kicks its player.
 *
 * @remarks
 *   Private and non-tunable on purpose: it bounds a retry loop, it is not a gameplay knob, and a
 *   `Constant` would make this module require `configureConstant()` before its first load — for a
 *   value no game should be changing.
 */
const LOAD_ATTEMPT_LIMIT = 3;

/**
 * Failed loads per discriminator, cleared when a load succeeds or its session ends.
 *
 * @remarks
 *   The retry after a failed load is driven by the caller polling this hook, so it needs a bound:
 *   `waitForPlayerLoaded` polls once a second and a render loop can poll every frame, which would
 *   turn a DataStore outage into a load storm. Keyed by discriminator rather than by `Player` so a
 *   failure outlives a rejoin inside the same load sequence — the entry is dropped when the session
 *   ends or the load succeeds.
 */
const attempts = new Map<string, number>();

/**
 * A hook that retrieves a Dataforge Profile for a given player. Handles loading and caching of
 * player documents in the shared store.
 *
 * @remarks
 *   A load is claimed synchronously by writing the `None` sentinel into `store.documents`, so
 *   concurrent callers share one load instead of starting their own. Every path that does not cache
 *   a profile clears the slot again: a leaver's abandoned load and a failed one both retry, and
 *   only a successful load leaves a profile behind. Retries are bounded at three attempts per
 *   discriminator; after that the hook stops touching the store and a caller that supplied a
 *   `player` is kicked rather than left waiting.
 * @param dataStore - The Dataforge store to load profiles from.
 * @param userId - The userId of the player.
 * @param player - The Player instance (optional). When present it supplies the name for logging and
 *   receives the kick once the load attempts are exhausted. Omitting it loads and caches the
 *   document without a kick target; it does **not** mean the player has left.
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
		if ((attempts.get(discriminator) ?? 0) >= LOAD_ATTEMPT_LIMIT) {
			// Already given up on this discriminator: answer `undefined` without touching the store.
			return { discriminator, document: undefined };
		}

		Log.Info(`loading document for Player: ${name}`);
		store.documents[discriminator] = None as never;

		Promise.defer<Profile<CollectionData>>((resolve, reject) => {
			const loaded = dataStore.load(discriminator, [userId]);

			if (!loaded.success) {
				reject(loaded.error);
				return;
			}

			resolve(loaded.value);
		})
			.then((profile) => {
				/*
				 * Only a player who has *left* abandons the load. A missing `player` is the
				 * no-kick-target overload — reading it as "left" left that overload permanently
				 * unable to answer a document (#76).
				 */
				if (player !== undefined && !player.Parent) {
					profile.unload();
					// The session is over, so the next one starts with a clean attempt count.
					attempts.delete(discriminator);
					delete store.documents[discriminator];
					return;
				}

				attempts.delete(discriminator);

				Log.Info(`document loaded for Player: ${name}`);
				store.documents[discriminator] = profile;

				profile.on_closed(() => {
					/*
					 * A rejoining player's profile can replace this one before this callback runs, so
					 * only evict the slot if it still holds the profile that closed.
					 */
					if (store.documents[discriminator] !== profile) {
						return;
					}

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
				const failed = (attempts.get(discriminator) ?? 0) + 1;
				attempts.set(discriminator, failed);

				/*
				 * Clearing the sentinel is what makes the next call retry. Leaving it behind made the
				 * discriminator permanently unusable: every later call saw the sentinel, concluded a
				 * load was in flight, and started nothing (#76).
				 */
				delete store.documents[discriminator];

				const exhausted = failed >= LOAD_ATTEMPT_LIMIT;
				Log.Warn(
					`Document failed to load for Player: ${name} (${err}); attempt ${failed}/${LOAD_ATTEMPT_LIMIT}`,
				);

				if (exhausted) {
					Log.Warn(`Giving up loading the document for Player: ${name}`);

					if (player?.Parent) {
						player.Kick("Document failed to load, please rejoin");
					}
				}
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

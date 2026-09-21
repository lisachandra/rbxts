import type { AnyEntity } from "@rbxts/matter";

/**
 * Tracks which players have received their initial replication payload and which entities each
 * player knows about.
 *
 * @remarks
 *   Owns all per-player replication bookkeeping behind a small interface so the server replication
 *   system can delegate to it without holding module-level mutable state. Backed by a `Set<Player>`
 *   for received payloads and a `Map<Player, Set<AnyEntity>>` for known entities; new trackers
 *   start empty.
 */
export interface ReplicationTracker {
	/**
	 * Checks whether a player has received their initial payload.
	 *
	 * @param player - Player to query.
	 * @returns Whether the player has been marked as received.
	 */
	hasReceived(player: Player): boolean;

	/**
	 * Marks a player as having received their initial payload.
	 *
	 * @param player - Player to mark.
	 */
	markReceived(player: Player): void;

	/**
	 * Records that a player knows about an entity.
	 *
	 * @param player - Player that now knows the entity.
	 * @param entity - Entity the player knows about.
	 */
	trackEntity(player: Player, entity: AnyEntity): void;

	/**
	 * Checks whether a player knows about an entity.
	 *
	 * @param player - Player to query.
	 * @param entity - Entity to check.
	 * @returns Whether the player knows about the entity.
	 */
	knowsEntity(player: Player, entity: AnyEntity): boolean;

	/**
	 * Returns the set of entities a player knows about.
	 *
	 * @remarks
	 *   Returns the tracker's internal set; callers may mutate it to replace the player's known
	 *   entities wholesale.
	 * @param player - Player to query.
	 * @returns The player's set of known entities (empty set if none tracked yet).
	 */
	entitiesFor(player: Player): Set<AnyEntity>;

	/**
	 * Removes all state for a player.
	 *
	 * @remarks
	 *   Idempotent: calling for an unknown or already-disposed player is a no-op.
	 * @param player - Player to dispose.
	 */
	dispose(player: Player): void;
}

/**
 * Creates a new empty replication tracker.
 *
 * @returns A fresh {@link ReplicationTracker} instance.
 */
export function createReplicationTracker(): ReplicationTracker {
	const received = new Set<Player>();
	const entities = new Map<Player, Set<AnyEntity>>();

	return {
		dispose(player) {
			received.delete(player);
			entities.delete(player);
		},
		entitiesFor(player) {
			let set = entities.get(player);
			if (!set) {
				set = new Set<AnyEntity>();
				entities.set(player, set);
			}

			return set;
		},
		hasReceived(player) {
			return received.has(player);
		},

		knowsEntity(player, entity) {
			return entities.get(player)?.has(entity) ?? false;
		},
		markReceived(player) {
			received.add(player);
		},
		trackEntity(player, entity) {
			let set = entities.get(player);
			if (!set) {
				set = new Set<AnyEntity>();
				entities.set(player, set);
			}

			set.add(entity);
		},
	};
}

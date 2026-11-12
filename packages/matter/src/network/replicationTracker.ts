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
	 * Records that a player no longer knows about an entity.
	 *
	 * @remarks
	 *   Idempotent: forgetting an entity the player never knew is a no-op.
	 * @param player - Player that no longer knows the entity.
	 * @param entity - Entity to forget.
	 */
	forgetEntity(player: Player, entity: AnyEntity): void;

	/**
	 * Checks whether a player knows about an entity.
	 *
	 * @param player - Player to query.
	 * @param entity - Entity to check.
	 * @returns Whether the player knows about the entity.
	 */
	knowsEntity(player: Player, entity: AnyEntity): boolean;

	/**
	 * Returns a snapshot of the entities a player knows about.
	 *
	 * @remarks
	 *   A copy, not the tracker's internal set: writing to the result cannot change replication
	 *   state. An earlier version returned the internal `Set`, which let any caller clear or
	 *   rewrite a player's known entities without the tracker knowing. State changes go through
	 *   {@link trackEntity} and {@link forgetEntity} only.
	 * @param player - Player to query.
	 * @returns The player's known entities at the time of the call (empty if none tracked yet).
	 */
	entitiesFor(player: Player): ReadonlySet<AnyEntity>;

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

	/** The mutable set for a player, created on first use. */
	function mutableEntitiesFor(player: Player): Set<AnyEntity> {
		let set = entities.get(player);
		if (!set) {
			set = new Set<AnyEntity>();
			entities.set(player, set);
		}

		return set;
	}

	return {
		dispose(player) {
			received.delete(player);
			entities.delete(player);
		},
		entitiesFor(player) {
			/*
			 * A snapshot, not the live set. `ReadonlySet` is erased at runtime, so returning the
			 * internal set would still let a caller `clear()` it — the type would only be a promise.
			 * The copy is built by hand because roblox-ts's `Set` constructor takes an array.
			 */
			const snapshot = new Set<AnyEntity>();
			for (const entity of entities.get(player) ?? new Set<AnyEntity>()) {
				snapshot.add(entity);
			}

			return snapshot;
		},
		forgetEntity(player, entity) {
			entities.get(player)?.delete(entity);
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
			mutableEntitiesFor(player).add(entity);
		},
	};
}

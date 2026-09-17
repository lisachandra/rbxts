/**
 * Tracks which players have received their initial replication payload.
 *
 * @remarks
 *   Backed by a `Set<Player>`; new trackers start empty.
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
}

/**
 * Creates a new empty replication tracker.
 *
 * @returns A fresh {@link ReplicationTracker} instance.
 */
export function createReplicationTracker(): ReplicationTracker {
	const received = new Set<Player>();

	return {
		hasReceived(player) {
			return received.has(player);
		},
		markReceived(player) {
			received.add(player);
		},
	};
}

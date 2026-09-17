import { createReplicationTracker, type ReplicationTracker } from "@lisachandra/matter";
import { describe, expect, it } from "@rbxts/jest-globals";

const player = {} as Player;
const otherPlayer = {} as Player;

function freshTracker(): ReplicationTracker {
	return createReplicationTracker();
}

describe("replication tracker", () => {
	describe("hasReceived / markReceived", () => {
		it("should track whether a player has received initial payload", () => {
			expect.assertions(2);

			const tracker = freshTracker();

			expect(tracker.hasReceived(player)).toBe(false);

			tracker.markReceived(player);

			expect(tracker.hasReceived(player)).toBe(true);
		});

		it("should be idempotent when a player is marked received multiple times", () => {
			expect.assertions(1);

			const tracker = freshTracker();

			tracker.markReceived(player);
			tracker.markReceived(player);

			expect(tracker.hasReceived(player)).toBe(true);
		});

		it("should not affect other players", () => {
			expect.assertions(2);

			const tracker = freshTracker();

			tracker.markReceived(player);

			expect(tracker.hasReceived(player)).toBe(true);
			expect(tracker.hasReceived(otherPlayer)).toBe(false);
		});
	});
});

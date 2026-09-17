import { createReplicationTracker, type ReplicationTracker } from "@lisachandra/matter";
import { describe, expect, it } from "@rbxts/jest-globals";
import type { AnyEntity } from "@rbxts/matter";

const player = {} as Player;
const otherPlayer = {} as Player;
const entityA = 1 as AnyEntity;
const entityB = 2 as AnyEntity;

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

	describe("trackEntity / knowsEntity / entitiesFor", () => {
		it("should track known entities per player", () => {
			expect.assertions(4);

			const tracker = freshTracker();

			expect(tracker.knowsEntity(player, entityA)).toBe(false);
			expect(() => tracker.entitiesFor(player).size()).toBe(0);

			tracker.trackEntity(player, entityA);

			expect(tracker.knowsEntity(player, entityA)).toBe(true);
			expect(tracker.entitiesFor(player).has(entityA)).toBe(true);
		});

		it("should keep entities isolated between players", () => {
			expect.assertions(4);

			const tracker = freshTracker();

			tracker.trackEntity(player, entityA);

			expect(tracker.knowsEntity(player, entityA)).toBe(true);
			expect(tracker.knowsEntity(otherPlayer, entityA)).toBe(false);
			expect(tracker.entitiesFor(player).has(entityA)).toBe(true);
			expect(tracker.entitiesFor(otherPlayer).has(entityA)).toBe(false);
		});

		it("should track multiple entities for the same player", () => {
			expect.assertions(3);

			const tracker = freshTracker();

			tracker.trackEntity(player, entityA);
			tracker.trackEntity(player, entityB);

			expect(tracker.knowsEntity(player, entityA)).toBe(true);
			expect(tracker.knowsEntity(player, entityB)).toBe(true);
			expect(() => tracker.entitiesFor(player).size()).toBe(2);
		});
	});
});

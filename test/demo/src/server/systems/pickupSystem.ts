import type { Crate } from "@rbxts/crate";
import type { AnyEntity, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type { ServerState } from "@lisachandra/core/out/store";
import { vector } from "@lisachandra/core";
import { Components } from "@lisachandra/matter";
import { GARDEN_INTERACTION_RADIUS, GARDEN_PICKUP_RESPAWN_TIME } from "shared/game/constants";
import { applyPickupVisual, getCharacterRoot, pushNotification, setCarryState } from "server/game/helpers";

function system(world: World): void {
	const now = os.clock();

	for (const [pickupEntity, pickup] of world.query(Components.ResourcePickup)) {
		if (pickup.amount > 0 || pickup.respawnAt === undefined || pickup.respawnAt > now) {
			continue;
		}

		applyPickupVisual(pickup.part, pickup.kind, true);
		world.insert(
			pickupEntity,
			Components.ResourcePickup({
				...pickup,
				amount: 1,
				respawnAt: undefined,
			}),
		);
	}

	for (const [entityId, profile] of world.query(Components.Profile)) {
		const root = getCharacterRoot(profile.player);
		if (!root) {
			continue;
		}

		let carry = world.get(entityId, Components.CarryState);
		if (!carry) {
			carry = Components.CarryState({ amount: 0 });
			world.insert(entityId, carry);
		}

		if (carry.amount > 0) {
			continue;
		}

		let nearestEntity: AnyEntity | undefined;
		let nearestPickup: Components["ResourcePickup"] | undefined;
		let nearestDistance = math.huge;

		for (const [pickupEntity, pickup] of world.query(Components.ResourcePickup)) {
			if (pickup.amount <= 0) {
				continue;
			}

			const dist = vector.distance(root.Position, pickup.part.Position);
			if (dist > GARDEN_INTERACTION_RADIUS || dist >= nearestDistance) {
				continue;
			}

			nearestDistance = dist;
			nearestEntity = pickupEntity;
			nearestPickup = pickup;
		}

		if (!nearestPickup || nearestEntity === undefined) {
			continue;
		}

		applyPickupVisual(nearestPickup.part, nearestPickup.kind, false);
		setCarryState(world, entityId, nearestPickup.kind, nearestPickup.amount);
		world.insert(
			nearestEntity,
			Components.ResourcePickup({
				...nearestPickup,
				amount: 0,
				respawnAt: now + GARDEN_PICKUP_RESPAWN_TIME,
			}),
		);
		pushNotification(world, entityId, `Picked up ${nearestPickup.kind}`);
	}

	world.commitCommands();
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;

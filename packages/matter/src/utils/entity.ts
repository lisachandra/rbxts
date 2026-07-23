import type { AnyEntity, Component, World } from "@rbxts/matter";
import { Players } from "@rbxts/services";
import { ComponentKey, isComponent } from "../components";
import { getEntityComponentByName, getEntityHumanoidComponent, getEntityInstanceComponent, } from "../entityLookup";

import type { Humanoid } from "@lisachandra/core/schemas";
import { store } from "@lisachandra/core/store";

import { getHumanoid } from "@lisachandra/core/utils/main";
import { iterate } from "@lisachandra/core/utils/type";

/**
 * Checks if an entity is alive in the world by verifying it exists
 * and has a valid Humanoid.
 *
 * @param world - The Matter world instance.
 * @param entityId - The ID of the entity to check. Defaults to -1.
 * @returns `true` if the entity exists and has a Humanoid, `false`
 *   otherwise.
 */
export function isAlive(world: World, entityId: AnyEntity = -1 as AnyEntity): boolean {
    return world.contains(entityId)
        ? getHumanoid(getComponentObject(getEntityHumanoidComponent(world, entityId))) !== undefined
        : false;
}

/**
 * Recursively searches an instance's ancestry for a "clientEntityId"
 * attribute.
 *
 * @param instance - The instance to start the search from.
 * @returns The clientEntityId if found, undefined otherwise.
 */
export function findClientEntityIdFromInstance(instance?: Instance): N<AnyEntity> {
    return instance
        ? (instance.GetAttribute<AnyEntity>("clientEntityId") ??
            findClientEntityIdFromInstance(instance.Parent))
        : undefined;
}

/**
 * Recursively searches an instance's ancestry for a "serverEntityId"
 * attribute.
 *
 * @param instance - The instance to start the search from.
 * @returns The serverEntityId if found, undefined otherwise.
 */
export function findServerEntityIdFromInstance(instance?: Instance): N<AnyEntity> {
    return instance
        ? (instance.GetAttribute<AnyEntity>("serverEntityId") ??
            findServerEntityIdFromInstance(instance.Parent))
        : undefined;
}

/**
 * Searches the entityIdMap for the clientEntityId.
 *
 * @param serverEntityId - The entityId on the server.
 * @returns The clientEntityId if found, undefined otherwise.
 * @client
 */
export function findClientEntityIdFromMap(
    serverEntityId: AnyEntity,
    entityIdMap = store.client.getState("entityIdMap"),
): N<AnyEntity> {
    return entityIdMap[serverEntityId];
}

/**
 * Searches the entityIdMap for the serverEntityId.
 *
 * @param clientEntityId - The entityId on the server.
 * @returns The serverEntityId if found, undefined otherwise.
 * @client
 */
export function findServerEntityIdFromMap(
    clientEntityId: AnyEntity,
    entityIdMap = store.client.getState("entityIdMap"),
): N<AnyEntity> {
    for (const [serverEntityId, clientId] of iterate(entityIdMap)) {
        if (clientId === clientEntityId) {
            return serverEntityId;
        }
    }

    return undefined;
}

/**
 * Whether the client owns the character of a certain entity.
 *
 * @param entityId - The entity id to check.
 * @returns If the client owns the entity.
 * @client
 */
export function ownsEntity(entityId: AnyEntity): boolean {
    const npc = getEntityComponentByName(store.world, entityId, "NPC" as ComponentKey) as { owner?: Player } | undefined;
    const profile = getEntityComponentByName(store.world, entityId, "Profile") as
        | { player?: Player }
        | undefined;

    return (npc?.owner ?? profile?.player) === Players.LocalPlayer;
}

/**
 * Retrieves the primary Roblox object associated with a given Matter
 * component.
 *
 * @param component - The Matter component.
 * @returns The associated Roblox object (e.g., RootPart, Model), or
 *   undefined if not applicable.
 */
export function getComponentObject(component?: Component<object>): N<PVInstance> {
    if (isComponent(component, "Profile")) {
        return component.player.Character;
    }

    if (isComponent(component, "Items")) {
        // Returns Model unless 'Moved', See component definition.
        return !(component.moved ?? false) ? component.model : undefined;
    }

    if (typeIs(component, "table") && "model" in component) {
        return component.model as PVInstance;
    }

    return undefined;
}

/**
 * Gets the position of a Matter component's associated Roblox object.
 *
 * @param component - The Matter component.
 * @returns The position, or undefined if no associated object or position
 *   exists.
 */
export function getComponentPosition(component?: Component<object>): N<Vector3> {
    return getComponentObject(component)?.GetPivot().Position;
}

/**
 * Gets the primary object associated with an entity using the configured
 * entity lookup component order.
 *
 * @param entityId - The ID of the entity in the world.
 * @returns The instance representing the entity, or undefined if not found
 *   or no suitable component exists.
 */
export function getEntityObject(entityId: AnyEntity = -1 as AnyEntity): N<PVInstance> {
    const world = store.world.contains(entityId) ? store.world : undefined;

    return world !== undefined ? getComponentObject(getEntityInstanceComponent(world, entityId)) : undefined;
}

/**
 * Gets the world position of an entity using the configured entity lookup
 * component order.
 *
 * @param entityId - The ID of the entity in the world.
 * @returns The position of the entity, or undefined if the entity or its
 *   position could not be determined.
 */
export function getEntityPosition(entityId: AnyEntity = -1 as AnyEntity): N<Vector3> {
    const world = store.world.contains(entityId) ? store.world : undefined;

    return world !== undefined ? getComponentPosition(getEntityInstanceComponent(world, entityId)) : undefined;
}

/**
 * Gets the entity Humanoid from it's npc model or player.
 *
 * @param entityId - The ID of the entity in the world.
 * @param nonStrict - If true, returns the Humanoid even if it's dead or
 *   missing a RootPart.
 * @returns The entities Humanoid.
 */
export function getEntityHumanoid(entityId?: AnyEntity, nonStrict = false): N<Humanoid> {
    const resolvedEntityId = entityId ?? (-1 as AnyEntity);

    if (!store.world.contains(resolvedEntityId)) {
        return;
    }

    return getHumanoid(
        getComponentObject(getEntityHumanoidComponent(store.world, resolvedEntityId)),
        nonStrict,
    );
}

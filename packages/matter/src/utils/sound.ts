import type { Character } from "@lisachandra/core/schemas";
import type { AnyEntity, World } from "@rbxts/matter";
import { RunService } from "@rbxts/services";

import { Components } from "../components";
import { assembleSoundComponent, emitAudioNode, soundEmitterCache } from "./audioEmitter";
import type { AudioEmitterNode, AudioPlayback } from "./audioEmitter";
import { getEntityObject } from "./entity";

/*
 * Backward-compatible re-exports from the deepened audio emitter module. The emitter module now
 * owns the cache-part lifecycle, playback transport, and `Wire` chaining, so these previously
 * local symbols are re-exported here to keep existing consumer imports intact.
 */
export { applyPlayback, connectAudio, rearrangeAudio, soundEmitterCache } from "./audioEmitter";
export type { AudioPlayback, ObjectCachePart } from "./audioEmitter";

/** A cached audio emitter node part ready for placement. */
export type SoundEmitterNode = AudioEmitterNode;

/**
 * Finds a free audio node belonging to a character's entity.
 *
 * Searches for entities with both `Sound` and `Node` components that are descendants of the
 * character. Returns an audio node if one is found where all audio players have finished playing.
 *
 * @param world - The Matter world instance to query.
 * @param entityId - The ID of the entity whose character to search.
 * @returns A free audio node part, or `undefined` if none is
 * available.
 */
export function findFreeAudioNode(world: World, entityId: AnyEntity): N<AudioEmitterNode> {
	const character = getEntityObject(entityId) as N<Character>;
	if (!character) {
		return undefined;
	}

	for (const [_nodeEntityId, sound, node] of world.query(Components.Sound, Components.Node)) {
		if (!node.model.IsDescendantOf(character) || !sound?.emitter || !sound.players) {
			continue;
		}

		return sound.players.every((player) => !player.IsPlaying)
			? (node.model as AudioEmitterNode)
			: undefined;
	}

	return undefined;
}

/**
 * Places an audio node onto a character for sound playback.
 *
 * Retrieves a node from the cache (or uses the provided one), assigns the sound asset to its
 * `AudioPlayer`, and parents the node to the character at the character's current pivot.
 *
 * @param sound - The Sound object containing the audio asset ID.
 * @param model - The character to attach the audio node to.
 * @param node - An optional pre-existing audio node to reuse.
 * @returns The audio node part placed on the character.
 */
export function placeAudioToModel(
	sound: Sound,
	model: Model,
	node: N<AudioEmitterNode>,
): AudioEmitterNode {
	const node0 = node ?? soundEmitterCache.GetPart();
	const player = node0.Attachment.AudioPlayer;
	player.Asset = sound.SoundId;
	node0.Parent = model;
	node0.CFrame = model.GetPivot();

	return node0;
}

/**
 * Places an audio node onto a model with the authored profile and optional playback override.
 *
 * Same as {@link placeAudioToModel} but also copies the sound template's authored profile (looping,
 * both regions, speed, volume) onto the player and applies an optional playback diff. Consolidates
 * the `createXAudioNode` + `applyPlaybackToPlayer` wiring every game audio system used to
 * hand-roll. Delegates to the shared {@link emitAudioNode} in the emitter module.
 *
 * @param sound - The Sound object containing the audio asset ID.
 * @param model - The model to attach the audio node to.
 * @param playback - Optional playback config: a whole authored `Sound` profile, or per-key
 *   overrides applied on top of the sound template's profile.
 * @param node - An optional pre-existing audio node to reuse.
 * @returns The configured audio node part.
 */
export function placeAudioToModelWithPlayback(
	sound: Sound,
	model: Model,
	playback?: AudioPlayback,
	node?: N<AudioEmitterNode>,
): AudioEmitterNode {
	return emitAudioNode({ node, playback, sound, target: model }).node;
}

/**
 * Places an audio node at a world-space position with the authored profile and optional playback
 * override.
 *
 * For transient spatial emitters (ball impacts, goal explosions, boost pad pickups) that have no
 * owning model. The node stays under the sound cache but is positioned at `position`, so the
 * `AudioEmitter` spatializes correctly.
 *
 * @param sound - The Sound object containing the audio asset ID.
 * @param position - World-space position for the emitter.
 * @param playback - Optional playback config: a whole authored `Sound` profile, or per-key
 *   overrides applied on top of the sound template's profile.
 * @param node - An optional pre-existing audio node to reuse.
 * @returns The configured audio node part.
 */
export function placeAudioAtPosition(
	sound: Sound,
	position: Vector3,
	playback?: AudioPlayback,
	node?: AudioEmitterNode,
): AudioEmitterNode {
	return emitAudioNode({ node, playback, sound, target: position }).node;
}

/**
 * Spawns a standalone audio `Sound` + `Node` entity into the world.
 *
 * The one-liner equivalent of {@link placeModelAudioInWorld} for objects that are _not_ ECS
 * entities (cars by model handle, boost pads, the ball, goal explosions). Creates the audio node on
 * the given model (or at the given position), applies playback configuration, then spawns an entity
 * with `Components.Sound` and `Components.Node`. The `Node` component is parented for the game's
 * node-length-auditing cleanup (see `../systems/shared/world/nodeManager`), which returns the
 * cached model to `soundEmitterCache` instead of destroying it, so the node is reusable.
 *
 * @param world - The Matter world instance.
 * @param sound - The Sound template whose `SoundId` and `id` attribute back the node.
 * @param nodeMarker - Marker value stored on the `Node` component; keep game-specific markers in
 *   the game's own constants.
 * @param target - A `Model` to attach the node to, or a `Vector3` world position for transient
 *   spatial emitters.
 * @param playback - Optional playback configuration applied to the node's player.
 * @returns The spawned `entityId` and the configured audio node.
 */
export function spawnAudioNode(
	world: World,
	sound: Sound,
	nodeMarker: number,
	target: Model | Vector3,
	playback?: AudioPlayback,
): { readonly entityId: AnyEntity; readonly node: AudioEmitterNode } {
	const emitted = emitAudioNode({ playback, sound, target });

	const entityId = world.spawn(
		Components.Sound(assembleSoundComponent(emitted.node, emitted.soundId)),
		Components.Node({
			type: nodeMarker,
			model: emitted.node,
		}),
	);

	return { entityId, node: emitted.node };
}

/**
 * Places character audio into the world and registers the necessary ECS components.
 *
 * Creates a sound emitter node on the character, then inserts `Sound`, `Node`, and (on the server)
 * `ReplicationScope` components into the entity's component set.
 *
 * @param world - The Matter world instance.
 * @param entityId - The ID of the entity to attach the sound to.
 * @param sound - The Sound object to play.
 * @param nodeMarker - An optional marker value for the node type. Defaults to 0.
 */
export function placeModelAudioInWorld(
	world: World,
	entityId: AnyEntity,
	sound: Sound,
	nodeMarker = 0,
): void {
	const character = getEntityObject(entityId) as N<Character>;
	if (!character) {
		return;
	}

	const soundId = sound.GetAttribute<number>("id")!;
	const emitted = emitAudioNode({
		node: findFreeAudioNode(world, entityId),
		sound,
		target: character,
	});
	const { node } = emitted;

	world.insert(
		entityId,
		...[
			Components.Sound(
				RunService.IsClient() ? assembleSoundComponent(node, soundId) : { id: soundId },
			),
			Components.Node({
				type: nodeMarker,
				model: node,
			}),
			(RunService.IsServer()
				? Components.ReplicationScope([
						{
							components: ["Sound"],
							ids: [entityId],
							mode: "exclude",
						},
					])
				: undefined)!,
		],
	);
}

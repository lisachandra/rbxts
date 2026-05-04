import type { AnyEntity, World } from "@rbxts/matter";
import ObjectCache from "@rbxts/object-cache";
import { RunService, Workspace } from "@rbxts/services";

import type { Character } from "@lisachandra/core/out/schemas";
import { getEntityObject } from "./entity";
import { getComponent } from "../components";

type ObjectCachePart<T> = T extends ObjectCache<infer U> ? U : never;

/**
 * Connects two audio-related Instances using a Wire for audio
 * routing.
 *
 * Creates a `Wire` instance that links the source to the target,
 * parenting the wire to the source.
 *
 * @param source - The source Instance to connect from.
 * @param target - The target Instance to connect to.
 */
export function connectAudio(source: Instance, target: Instance): void {
	const wire = new Instance("Wire");
	wire.SourceInstance = source;
	wire.TargetInstance = target;
	wire.Parent = source;
}

/**
 * Reconnects a chain of audio sources in sequence.
 *
 * Destroys all existing Wires on each source and creates new Wires
 * to chain them together in the order provided (source[i] →
 * source[i+1]). Does nothing if fewer than 2 sources are provided.
 *
 * @param sources - An array of audio Instances to chain together.
 */
export function rearrangeAudio(sources: Array<Instance>): void {
	if (sources.size() < 2) {
		return;
	}

	for (const source of sources) {
		for (const child of source.GetChildren()) {
			if (child.IsA("Wire")) {
				child.Destroy();
			}
		}
	}

	for (const index of $range(0, sources.size() - 2)) {
		const source = sources[index]!;
		const target = sources[index + 1]!;
		connectAudio(source, target);
	}
}

// eslint-disable-next-line ts/explicit-function-return-type -- Infer return type
function createSoundEmitterCache() {
	const effects = new Instance("Folder") as Folder & {
		/* eslint-disable ts/naming-convention -- Cache template initialization */
		AudioFader: AudioFader;
		AudioFilter: AudioFilter;
		/* eslint-enable ts/naming-convention */
	};
	{
		const filter = new Instance("AudioFilter");
		const fader = new Instance("AudioFader");
		effects.Name = "AudioEffects";
		filter.Parent = effects;
		fader.Parent = effects;
	}

	const node = new Instance("Part") as Part & {
		/* eslint-disable ts/naming-convention -- Cache template initialization */
		Attachment: Attachment & {
			AudioEffects: typeof effects;
			AudioEmitter: AudioEmitter;
			AudioPlayer: AudioPlayer;
		};
		/* eslint-enable ts/naming-convention */
	};
	{
		const emitter = new Instance("Attachment");
		const player = new Instance("AudioPlayer");
		const emit = new Instance("AudioEmitter");

		node.Anchored = true;
		node.Transparency = 1;
		node.CanCollide = false;
		node.CanQuery = false;
		node.CanTouch = false;
		player.Parent = emitter;
		emit.Parent = emitter;
		effects.Parent = emitter;
		emitter.Parent = node;

		rearrangeAudio([player, ...effects.GetChildren(), emit]);
	}

	return new ObjectCache(node, 50, Workspace.Caches.Sound);
}

/**
 * Finds a free audio node belonging to a character's entity.
 *
 * Searches for entities with both `Sound` and `Node` components
 * that are descendants of the character. Returns an audio node if
 * one is found where all audio players have finished playing.
 *
 * @param world - The Matter world instance to query.
 * @param entityId - The ID of the entity whose character to search.
 * @returns A free audio node part, or `undefined` if none is
 *   available.
 */
export function findFreeAudioNode(
	world: World,
	entityId: AnyEntity,
): N<ObjectCachePart<ReturnType<typeof createSoundEmitterCache>>> {
	const character = getEntityObject(entityId) as N<Character>;
	if (!character) {
		return undefined;
	}

	for (const [_nodeEntityId, sound, node] of world.query(getComponent("Sound"), getComponent("Node"))) {
		if (!node.model.IsDescendantOf(character) || !sound?.emitter || !sound.players) {
			continue;
		}

		return sound.players.every((player) => !player.IsPlaying)
			? (node.model as ObjectCachePart<ReturnType<typeof createSoundEmitterCache>>)
			: undefined;
	}

	return undefined
}

/**
 * A cache of reusable sound emitter parts for efficient audio
 * playback.
 *
 * Each cached part contains an `Attachment` with an `AudioPlayer`,
 * `AudioEmitter`, and `AudioEffects` (filter and fader). Parts are
 * reused from `Workspace.Caches.Sound` to minimize instance creation
 * overhead.
 */
export const soundEmitterCache = createSoundEmitterCache();

/**
 * Places an audio node onto a character for sound playback.
 *
 * Retrieves a node from the cache (or uses the provided one),
 * assigns the sound asset to its `AudioPlayer`, and parents the
 * node to the character at the character's current pivot.
 *
 * @param sound - The Sound object containing the audio asset ID.
 * @param character - The character to attach the audio node to.
 * @param node - An optional pre-existing audio node to reuse.
 * @returns The audio node part placed on the character.
 */
export function placeAudioToCharacter(
	sound: Sound,
	character: Character,
	node: N<ObjectCachePart<ReturnType<typeof createSoundEmitterCache>>>,
): ObjectCachePart<ReturnType<typeof createSoundEmitterCache>> {
	const node0 = node ?? soundEmitterCache.GetPart();
	const player = node0.Attachment.AudioPlayer;
	player.Asset = sound.SoundId;
	node0.Parent = character;
	node0.CFrame = character.GetPivot();

	return node0;
}

/**
 * Places character audio into the world and registers the necessary
 * ECS components.
 *
 * Creates a sound emitter node on the character, then inserts
 * `Sound`, `Node`, and (on the server) `ReplicationScope` components
 * into the entity's component set.
 *
 * @param world - The Matter world instance.
 * @param entityId - The ID of the entity to attach the sound to.
 * @param sound - The Sound object to play.
 * @param nodeMarker - An optional marker value for the node type.
 *   Defaults to 0.
 */
export function placeCharacterAudioInWorld(world: World, entityId: AnyEntity, sound: Sound, nodeMarker = 0) {
	const character = getEntityObject(entityId) as N<Character>;
	if (!character) {
		return;
	}

	const soundId = sound.GetAttribute<number>("id")!;
	const node = placeAudioToCharacter(
		sound,
		character,
		findFreeAudioNode(world, entityId),
	);
	const emitter = node.Attachment.AudioEmitter;
	const effects = node.Attachment.AudioEffects;
	const player = node.Attachment.AudioPlayer;

	world.insert(
		entityId,
		...[
			getComponent("Sound")(
				RunService.IsClient()
					? {
							effects: effects.GetChildren(),
							emitter,
							id: soundId,
							players: [player],
						}
					: { id: soundId },
			),
			getComponent("Node")({
				type: nodeMarker,
				model: node,
			}),
			(RunService.IsServer()
				? getComponent("ReplicationScope")([
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

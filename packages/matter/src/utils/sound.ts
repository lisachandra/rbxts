import type { Character } from "@lisachandra/core/schemas";
import type { AnyEntity, World } from "@rbxts/matter";
import ObjectCache from "@rbxts/object-cache";
import { RunService, Workspace } from "@rbxts/services";

import { Components } from "../components";
import { getEntityObject } from "./entity";

export type ObjectCachePart<T> = T extends ObjectCache<infer U> ? U : never;

/**
 * Connects two audio-related Instances using a Wire for audio routing.
 *
 * Creates a `Wire` instance that links the source to the target, parenting the wire to the source.
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
 * Destroys all existing Wires on each source and creates new Wires to chain them together in the
 * order provided (source[i] → source[i+1]). Does nothing if fewer than 2 sources are provided.
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
 * Searches for entities with both `Sound` and `Node` components that are descendants of the
 * character. Returns an audio node if one is found where all audio players have finished playing.
 *
 * @param world - The Matter world instance to query.
 * @param entityId - The ID of the entity whose character to search.
 * @returns A free audio node part, or `undefined` if none is
 * available.
 */
export function findFreeAudioNode(
	world: World,
	entityId: AnyEntity,
): N<ObjectCachePart<ReturnType<typeof createSoundEmitterCache>>> {
	const character = getEntityObject(entityId) as N<Character>;
	if (!character) {
		return undefined;
	}

	for (const [_nodeEntityId, sound, node] of world.query(Components.Sound, Components.Node)) {
		if (!node.model.IsDescendantOf(character) || !sound?.emitter || !sound.players) {
			continue;
		}

		return sound.players.every((player) => !player.IsPlaying)
			? (node.model as ObjectCachePart<ReturnType<typeof createSoundEmitterCache>>)
			: undefined;
	}

	return undefined;
}

/**
 * A cache of reusable sound emitter parts for efficient audio playback.
 *
 * Each cached part contains an `Attachment` with an `AudioPlayer`, `AudioEmitter`, and
 * `AudioEffects` (filter and fader). Parts are reused from `Workspace.Caches.Sound` to minimize
 * instance creation overhead.
 */
export const soundEmitterCache = createSoundEmitterCache();

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
	node: N<ObjectCachePart<ReturnType<typeof createSoundEmitterCache>>>,
): ObjectCachePart<ReturnType<typeof createSoundEmitterCache>> {
	const node0 = node ?? soundEmitterCache.GetPart();
	const player = node0.Attachment.AudioPlayer;
	player.Asset = sound.SoundId;
	node0.Parent = model;
	node0.CFrame = model.GetPivot();

	return node0;
}

/**
 * Playback override applied to an audio node's player.
 *
 * A partial of the `AudioPlayer`'s writable surface, applied as a diff on top of the authored
 * `Sound` template profile (see {@link applySoundProfile}). Anything unset inherits whatever the
 * profile carried over, so callers only specify what actually varies per spawn.
 *
 * @remarks
 *   `LoopRegion`/`PlaybackRegion` are intentionally included — a caller doing runtime region math
 *   can override them, while every other caller omits them and inherits the authored regions.
 */
type PlaybackOverrides = Partial<
	Pick<
		WritableInstanceProperties<AudioPlayer>,
		Exclude<
			keyof WritableInstanceProperties<AudioPlayer>,
			| "Asset"
			| "AssetId"
			| "AutoLoad"
			| "AutoPlay" // Identity + lifecycle the module owns — nothing audio-affecting excluded.
			| "AudioContent"
			| keyof Instance
		>
	>
>;
/** Playback config: a partial `AudioPlayer` surface, or a whole authored `Sound` profile. */
/* eslint-disable-next-line ts/consistent-type-definitions -- union type */
export type AudioPlayback = Sound | PlaybackOverrides;

/** `Sound` template keys whose authored value transports onto a player. */
type SoundProfileKey =
	| "Looped"
	| "Volume"
	| "SoundId"
	| "LoopRegion"
	| "PlaybackSpeed"
	| "PlaybackRegion";

/** Maps a `Sound` template property onto its `AudioPlayer` counterpart. */
interface SoundProfileMapping {
	readonly playerKey: keyof WritableInstanceProperties<AudioPlayer>;
}

/**
 * Authored playback profile carried from a `Sound` template onto a player.
 *
 * `Looped → Looping` is a rename rather than a property-for-property walk, so this is a mapping
 * adapter, not a copy. `Pitch` is deliberately absent — the player has no separate pitch surface,
 * and classic-game pitch adjustments stay game-side.
 */
const SOUND_PROFILE_MAP: Readonly<Record<SoundProfileKey, SoundProfileMapping>> = {
	Looped: { playerKey: "Looping" },
	LoopRegion: { playerKey: "LoopRegion" },
	PlaybackRegion: { playerKey: "PlaybackRegion" },
	PlaybackSpeed: { playerKey: "PlaybackSpeed" },
	SoundId: { playerKey: "Asset" },
	Volume: { playerKey: "Volume" },
};

/**
 * Copies the authored playback profile from a `Sound` template onto a player.
 *
 * The first half of two-layer transport — the second half is {@link applyPlayback}, applied after
 * this. Carries the full authored character (looping, both regions, speed, volume) to the emitter
 * so callers stop hand-specifying what the template already says.
 *
 * @param player - The `AudioPlayer` to configure.
 * @param sound - The `Sound` template whose authored profile to copy.
 */
function applySoundProfile(player: AudioPlayer, sound: Sound): void {
	for (const [soundKey, mapping] of pairs(SOUND_PROFILE_MAP)) {
		player[mapping.playerKey] = sound[soundKey] as never;
	}
}

/**
 * Places an audio node onto a model with the authored profile and optional playback override.
 *
 * Same as {@link placeAudioToModel} but also copies the sound template's authored profile (looping,
 * both regions, speed, volume) onto the player and applies an optional playback diff. Consolidates
 * the `createXAudioNode` + `applyPlaybackToPlayer` wiring every game audio system used to
 * hand-roll.
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
	node?: N<ObjectCachePart<ReturnType<typeof createSoundEmitterCache>>>,
): ObjectCachePart<ReturnType<typeof createSoundEmitterCache>> {
	const node0 = placeAudioToModel(sound, model, node);
	const player = node0.Attachment.AudioPlayer;
	applySoundProfile(player, sound);

	if (playback !== undefined) {
		applyPlayback(player, playback);
	}

	return node0;
}

/**
 * Applies playback configuration to an `AudioPlayer`.
 *
 * The second half of two-layer transport — a thin diff applied on top of the authored profile (see
 * {@link applySoundProfile}). Iterates the writable surface rather than assigning per-field, so
 * future `AudioPlayer` properties need a type-level change only.
 *
 * @param player - The `AudioPlayer` to configure.
 * @param playback - Playback config: a partial `AudioPlayer` surface (per-key override), or a whole
 *   authored `Sound` profile (wholesale replacement).
 */
export function applyPlayback(player: AudioPlayer, playback: AudioPlayback): void {
	// Whole authored `Sound` profile — copy the mapping straight across.
	if (typeIs(playback, "Instance")) {
		applySoundProfile(player, playback);
		return;
	}

	// Per-key override diff.
	for (const [key, value] of pairs(playback)) {
		player[key as keyof PlaybackOverrides] = value as never;
	}
}

/** A cached audio emitter node part ready for placement. */
export type SoundEmitterNode = ObjectCachePart<ReturnType<typeof createSoundEmitterCache>>;

/**
 * Places an audio node at a world-space position with the authored profile and optional playback
 * override.
 *
 * For transient spatial emitters (ball impacts, goal explosions, boost pad pickups) that have no
 * owning model. The node stays under the sound cache but is positioned at `position`, so the
 * `AudioEmitter` spatialises correctly.
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
	node?: SoundEmitterNode,
): SoundEmitterNode {
	const node0 = node ?? soundEmitterCache.GetPart();
	node0.CFrame = new CFrame(position);
	const player = node0.Attachment.AudioPlayer;
	applySoundProfile(player, sound);

	if (playback !== undefined) {
		applyPlayback(player, playback);
	}

	return node0;
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
): { readonly entityId: AnyEntity; readonly node: SoundEmitterNode } {
	const soundId = sound.GetAttribute<number>("id")!;
	const node = typeIs(target, "Vector3")
		? placeAudioAtPosition(sound, target, playback)
		: placeAudioToModelWithPlayback(sound, target, playback);
	const player = node.Attachment.AudioPlayer;
	const effects = node.Attachment.AudioEffects.GetChildren();
	const emitter = node.Attachment.AudioEmitter;

	const entityId = world.spawn(
		Components.Sound({
			effects,
			emitter,
			id: soundId,
			players: [player],
		}),
		Components.Node({
			type: nodeMarker,
			model: node,
		}),
	);

	return { entityId, node };
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
	const node = placeAudioToModel(sound, character, findFreeAudioNode(world, entityId));
	const emitter = node.Attachment.AudioEmitter;
	const effects = node.Attachment.AudioEffects;
	const player = node.Attachment.AudioPlayer;

	world.insert(
		entityId,
		...[
			Components.Sound(
				RunService.IsClient()
					? {
							effects: effects.GetChildren(),
							emitter,
							id: soundId,
							players: [player],
						}
					: { id: soundId },
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

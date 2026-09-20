import ObjectCache from "@rbxts/object-cache";
import { Workspace } from "@rbxts/services";

import type { Components } from "../components";
import { recordNodeReturned } from "../debug/soundDebugStats";

export type ObjectCachePart<T> = T extends ObjectCache<infer U> ? U : never;

/** An audio emitter node part: a cached Part with the audio-interface Attachment. */
export interface AudioEmitterNode extends Part {
	Attachment: Attachment & {
		AudioEffects: Folder & {
			AudioFader: AudioFader;
			AudioFilter: AudioFilter;
		};
		AudioEmitter: AudioEmitter;
		AudioPlayer: AudioPlayer;
	};
}

/** Options for emitting an audio node via {@link emitAudioNode}. */
export interface EmitAudioOptions {
	readonly node?: AudioEmitterNode;
	readonly playback?: AudioPlayback;
	readonly sound: Sound;
	readonly target: Model | Vector3;
}

/** The configured audio node returned from {@link emitAudioNode}. */
export interface EmittedAudioNode {
	readonly effects: Array<Instance>;
	readonly emitter: AudioEmitter;
	readonly node: AudioEmitterNode;
	readonly player: AudioPlayer;
	readonly soundId: number;
}

/**
 * Connects two audio-related Instances using a Wire for audio routing.
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
 * A cache of reusable sound emitter parts for efficient audio playback.
 *
 * Each cached part contains an `Attachment` with an `AudioPlayer`, `AudioEmitter`, and
 * `AudioEffects` (filter and fader). Parts are reused from `Workspace.Caches.Sound` to minimize
 * instance creation overhead.
 */
export const soundEmitterCache: ObjectCache<AudioEmitterNode> = createSoundEmitterCache();

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

/**
 * Assembles a `Components.Sound` payload from an audio emitter node.
 *
 * The single authoritative place that maps a configured node's children onto the `Sound`
 * component's client shape (`effects`, `emitter`, `id`, `players`). Eliminates the verbatim
 * three-call-site duplication.
 *
 * @param node - The configured audio emitter node part.
 * @param soundId - The sound template id.
 * @returns A `Components.Sound` payload.
 */
export function assembleSoundComponent(
	node: AudioEmitterNode,
	soundId: number,
): Components["Sound"] {
	return {
		effects: node.Attachment.AudioEffects.GetChildren(),
		emitter: node.Attachment.AudioEmitter,
		id: soundId,
		players: [node.Attachment.AudioPlayer],
	};
}

/**
 * Obtains an audio node part from cache (or reuses a provided one), positions it at a target
 * `Model` pivot or `Vector3`, and applies the two-layer playback config (authored `Sound` profile +
 * optional playback overrides).
 *
 * @param options - The sound, target, optional playback and reusable node.
 * @returns The configured node and its exposed emitter/player/effects/id.
 */
export function emitAudioNode(options: EmitAudioOptions): EmittedAudioNode {
	const { sound, target } = options;
	const node0 = (options.node ?? soundEmitterCache.GetPart()) as AudioEmitterNode;
	const player = node0.Attachment.AudioPlayer;

	player.Asset = sound.SoundId;
	applySoundProfile(player, sound);

	if (options.playback !== undefined) {
		applyPlayback(player, options.playback);
	}

	if (typeIs(target, "Vector3")) {
		node0.CFrame = new CFrame(target);
	} else {
		node0.Parent = target;
		node0.CFrame = target.GetPivot();
	}

	return {
		effects: node0.Attachment.AudioEffects.GetChildren(),
		emitter: node0.Attachment.AudioEmitter,
		node: node0,
		player: node0.Attachment.AudioPlayer,
		soundId: sound.GetAttribute<number>("id") ?? 0,
	};
}

/**
 * Derives the containing audio node part from an `AudioEmitter`.
 *
 * Replaces fragile parent-guessing (`emitter.Parent!.Parent!`) with a robust ancestor walk, then
 * validates the part carries the expected audio attachment structure.
 *
 * @param emitter - The `AudioEmitter` inside the node's attachment.
 * @returns The containing `AudioEmitterNode`, or `undefined` if none is found.
 */
export function getNodeFromEmitter(emitter: AudioEmitter): N<AudioEmitterNode> {
	const node = emitter.FindFirstAncestorWhichIsA("Part") as N<AudioEmitterNode>;
	if (
		node === undefined ||
		node.Attachment === undefined ||
		node.Attachment.AudioEmitter !== emitter
	) {
		return undefined;
	}

	return node;
}

/**
 * Derives the containing audio node part from a `Components.Sound` payload.
 *
 * Thin adapter over {@link getNodeFromEmitter} so callers holding only the component (for example GC
 * sweeps) do not reach into `sound.emitter.Parent` themselves.
 *
 * @param sound - The `Sound` component payload carrying the emitter.
 * @returns The containing `AudioEmitterNode`, or `undefined` if none is found.
 */
export function getNodeFromSoundComponent(sound: Components["Sound"]): N<AudioEmitterNode> {
	const { emitter } = sound;
	if (emitter === undefined) {
		return undefined;
	}

	return getNodeFromEmitter(emitter);
}

/**
 * Recycles an audio node part back to the sound emitter cache.
 *
 * Re-parents the node to `Workspace.Caches.Sound`, returns it to the underlying
 * `soundEmitterCache`, and records the return for diagnostics. Guards against foreign parts so a
 * hand-built `Part` can never corrupt the cache free-list.
 *
 * @param node - The audio node part to recycle.
 */
export function recycleAudioNode(node: AudioEmitterNode): void {
	const attachment = node.FindFirstChild("Attachment") as N<
		Attachment & { AudioEmitter: N<AudioEmitter> }
	>;
	if (attachment === undefined || attachment.AudioEmitter === undefined) {
		return;
	}

	node.Parent = Workspace.Caches.Sound;
	soundEmitterCache.ReturnPart(node);
	recordNodeReturned();
}

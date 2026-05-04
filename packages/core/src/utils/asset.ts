import { ReplicatedStorage, SoundService } from "@rbxts/services";

const animations = new Map<number, Animation>();
const sounds = new Map<number, Sound>();
const soundGroups = new Map<number, SoundGroup>();

for (const instance of SoundService.GetDescendants()) {
	if (instance.IsA("Sound")) {
		const id = instance.GetAttribute<number>("id");
		if (id !== undefined) {
			sounds.set(id, instance);
		}
	} else if (instance.IsA("SoundGroup")) {
		const id = instance.GetAttribute<number>("id");
		if (id !== undefined) {
			soundGroups.set(id, instance);
		}
	}
}

for (const instance of ReplicatedStorage.Animations.GetDescendants()) {
	if (instance.IsA("Animation")) {
		const id = instance.GetAttribute<number>("id");
		if (id !== undefined) {
			animations.set(id, instance);
		}
	}
}

/**
 * Retrieves a SoundGroup instance by its numeric ID.
 *
 * @param id - The numeric ID of the SoundGroup.
 * @returns The SoundGroup instance, or `undefined` if not found.
 * @example
 * ```ts
 * const soundGroup = getSoundGroupFromId(12345);
 * ```
 * @remarks
 * SoundGroups are indexed at module load time from all descendants of
 * SoundService that have an "id" attribute.
 */
export function getSoundGroupFromId(id: number): N<SoundGroup> {
	return soundGroups.get(id);
}

/**
 * Retrieves a Sound instance by its numeric ID.
 *
 * @param id - The numeric ID of the Sound.
 * @returns The Sound instance, or `undefined` if not found.
 * @example
 * ```ts
 * const sound = getSoundFromId(12345);
 * ```
 * @remarks
 * Sounds are indexed at module load time from all descendants of
 * SoundService that have an "id" attribute.
 */
export function getSoundFromId(id: number): N<Sound> {
	return sounds.get(id);
}

/**
 * Retrieves an Animation instance by its numeric ID.
 *
 * @param id - The numeric ID of the Animation.
 * @returns The Animation instance, or `undefined` if not found.
 * @example
 * ```ts
 * const animation = getAnimationFromId(12345);
 * ```
 * @remarks
 * Animations are indexed at module load time from all descendants of
 * ReplicatedStorage.Animations that have an "id" attribute.
 */
export function getAnimationFromId(id: number): N<Animation> {
	return animations.get(id);
}

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

export function getSoundGroupFromId(id: number): N<SoundGroup> {
	return soundGroups.get(id);
}

export function getSoundFromId(id: number): N<Sound> {
	return sounds.get(id);
}

export function getAnimationFromId(id: number): N<Animation> {
	return animations.get(id);
}

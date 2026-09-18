import { recycleAudioNode } from "@lisachandra/matter/utils/audioEmitter";
import {
	placeAudioAtPosition,
	placeAudioToModel,
	placeAudioToModelWithPlayback,
	spawnAudioNode,
} from "@lisachandra/matter/utils/sound";
import { describe, expect, it } from "@rbxts/jest-globals";
import { World } from "@rbxts/matter";
import { Workspace } from "@rbxts/services";

describe("spawnAudioNode", () => {
	it("should spawn standalone audio entity using the deepened emitter module", () => {
		expect.assertions(3);

		const world = new World();
		const sound = new Instance("Sound");
		sound.SetAttribute("id", 7);
		const target = new Vector3(1, 2, 3);

		const { entityId, node } = spawnAudioNode(world, sound, 9, target);

		expect(typeIs(entityId, "number")).toBe(true);
		expect(node.Attachment.AudioPlayer.Asset).toBe(sound.SoundId);
		expect(node.Position).toBe(target);

		recycleAudioNode(node);
		world.despawn(entityId);
	});
});

describe("utils/sound wrappers", () => {
	it("should place audio on a model via placeAudioToModel", () => {
		expect.assertions(2);

		const sound = new Instance("Sound");
		sound.SoundId = "rbxassetid://12345";
		const model = new Instance("Model");
		const part = new Instance("Part");
		part.Parent = model;
		model.PrimaryPart = part;
		model.Parent = Workspace;

		const node = placeAudioToModel(sound, model, undefined);

		expect(node.Parent).toBe(model);
		expect(node.Attachment.AudioPlayer.Asset).toBe(sound.SoundId);

		recycleAudioNode(node);
		model.Destroy();
	});

	it("should place audio on a model via placeAudioToModelWithPlayback", () => {
		expect.assertions(2);

		const sound = new Instance("Sound");
		sound.SoundId = "rbxassetid://12345";
		sound.Volume = 0.5;
		const model = new Instance("Model");
		const part = new Instance("Part");
		part.Parent = model;
		model.PrimaryPart = part;
		model.Parent = Workspace;

		const node = placeAudioToModelWithPlayback(sound, model);

		expect(node.Parent).toBe(model);
		expect(node.Attachment.AudioPlayer.Volume).toBe(0.5);

		recycleAudioNode(node);
		model.Destroy();
	});

	it("should place audio at a world position via placeAudioAtPosition", () => {
		expect.assertions(2);

		const sound = new Instance("Sound");
		const position = new Vector3(3, 4, 5);

		const node = placeAudioAtPosition(sound, position);

		expect(node.Position).toBe(position);
		expect(node.Attachment.AudioPlayer.Asset).toBe(sound.SoundId);

		recycleAudioNode(node);
	});
});

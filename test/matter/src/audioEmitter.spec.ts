import { readSoundDebugCounters } from "@lisachandra/matter/debug/soundDebugStats";
import {
	assembleSoundComponent,
	emitAudioNode,
	getNodeFromEmitter,
	recycleAudioNode,
} from "@lisachandra/matter/utils/audioEmitter";
import type { AudioEmitterNode } from "@lisachandra/matter/utils/audioEmitter";
import { describe, expect, it } from "@rbxts/jest-globals";
import { Workspace } from "@rbxts/services";

describe("audio emitter", () => {
	it("should acquire and configure a cached audio node part", () => {
		expect.assertions(12);

		const sound = new Instance("Sound");
		const target = new Vector3(10, 20, 30);

		const emitted = emitAudioNode({ sound, target });

		expect(emitted.node).never.toBeUndefined();
		expect(emitted.emitter).toBe(emitted.node.Attachment.AudioEmitter);
		expect(emitted.player).toBe(emitted.node.Attachment.AudioPlayer);
		expect(emitted.effects).toEqual(emitted.node.Attachment.AudioEffects.GetChildren());
		expect(emitted.soundId).toBe(0);

		// Node is placed at the target position.
		expect(emitted.node.Position).toBe(target);

		// Player is configured with the sound's id.
		expect(emitted.player.Asset).toBe(sound.SoundId);

		recycleAudioNode(emitted.node);
	});

	it("should place the node on a model pivot", () => {
		expect.assertions(4);

		const sound = new Instance("Sound");
		const model = new Instance("Model");
		const part = new Instance("Part");
		const pivot = new CFrame(5, 5, 5);
		part.Parent = model;
		model.PrimaryPart = part;
		part.Size = new Vector3(1, 1, 1);
		model.PivotTo(pivot);
		model.Parent = Workspace;

		const emitted = emitAudioNode({ sound, target: model });

		expect(emitted.node.Parent).toBe(model);
		expect(emitted.node.CFrame).toBe(pivot);
		expect(emitted.node.Position).toBe(pivot.Position);

		recycleAudioNode(emitted.node);
		model.Destroy();
	});
});

describe("assembleSoundComponent", () => {
	it("should assemble Sound component payload from an audio emitter node", () => {
		expect.assertions(4);

		const node = new Instance("Part") as AudioEmitterNode;
		// Build a minimal matching structure.
		const attachment = new Instance("Attachment");
		attachment.Name = "Attachment";
		const effects = new Instance("Folder");
		effects.Name = "AudioEffects";
		const filter = new Instance("AudioFilter");
		const fader = new Instance("AudioFader");
		filter.Parent = effects;
		fader.Parent = effects;
		const player = new Instance("AudioPlayer");
		const emitter = new Instance("AudioEmitter");
		player.Parent = attachment;
		effects.Parent = attachment;
		emitter.Parent = attachment;
		attachment.Parent = node;

		const component = assembleSoundComponent(node, 42);

		expect(component.id).toBe(42);
		expect(component.emitter).toBe(emitter);
		expect(component.players).toEqual([player]);
		expect(component.effects).toEqual([filter, fader]);

		node.Destroy();
	});
});

describe("getNodeFromEmitter", () => {
	it("should resolve audio node part from emitter without parent traversal guessing", () => {
		expect.assertions(2);

		const node = new Instance("Part") as AudioEmitterNode;
		const attachment = new Instance("Attachment");
		attachment.Name = "Attachment";
		const emitter = new Instance("AudioEmitter");
		emitter.Parent = attachment;
		attachment.Parent = node;
		node.Parent = Workspace;

		const resolved = getNodeFromEmitter(emitter);

		expect(resolved).never.toBeUndefined();
		expect(resolved).toBe(node);

		node.Destroy();
	});
});

describe("recycleAudioNode", () => {
	it("should recycle audio node back to cache and increment return diagnostics", () => {
		expect.assertions(3);

		const node = new Instance("Part") as AudioEmitterNode;
		node.Parent = Workspace;

		recycleAudioNode(node);

		expect(node.Parent).toBe(Workspace.Caches.Sound);
		expect(readSoundDebugCounters().nodeReturns).toBeGreaterThan(0);

		node.Destroy();
	});
});

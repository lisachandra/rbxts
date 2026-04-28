import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type ObjectCache from "@rbxts/object-cache";
import { Workspace } from "@rbxts/services";
import { placeAudioToCharacter, soundEmitterCache } from "../../../utils/sound";
import { ClientState } from "@lisachandra/core/out/store";
import { getComponent } from "../../../components";

type ObjectCachePart<T> = T extends ObjectCache<infer U> ? U : never;

function system(world: World): void {
	for (const [entityId, record] of world.queryChanged(getComponent("Sound"))) {
		if (record.old || !record.new) {
			continue;
		}

		const node = world.get(entityId, getComponent("Node"))?.model as ReturnType<
			typeof placeAudioToCharacter
		>;
		if (node === undefined) {
			continue;
		}

		const emitter = node.Attachment.AudioEmitter;
		const effects = node.Attachment.AudioEffects;
		const player = node.Attachment.AudioPlayer;

		world.insert(
			entityId,
			getComponent("Sound")({
				effects: effects.GetChildren(),
				emitter,
				id: record.new.id,
				players: [player],
			}),
		);
	}

	for (const [_entityId, node, _sound] of world.query(getComponent("Node"), getComponent("Sound"))) {
		if (game.IsAncestorOf(node.model)) {
			node.model.Parent = Workspace.Caches.Sound;
			soundEmitterCache.ReturnPart(node.model as ObjectCachePart<typeof soundEmitterCache>);
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;

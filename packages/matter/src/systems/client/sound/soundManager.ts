import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type ObjectCache from "@rbxts/object-cache";
import { Workspace } from "@rbxts/services";
import { Components } from "../../../components";
import { placeAudioToCharacter, soundEmitterCache } from "../../../utils/sound";
import { includes } from "@lisachandra/core/out/utils/string";
import { ClientState } from "@lisachandra/core/out/store";

type ObjectCachePart<T> = T extends ObjectCache<infer U> ? U : never;

function system(world: World): void {
	for (const [entityId, record] of world.queryChanged(Components.Sound)) {
		if (record.old || !record.new) {
			continue;
		}

		const node = world.get(entityId, Components.Node)?.model as ReturnType<
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
			Components.Sound({
				effects: effects.GetChildren(),
				emitter,
				id: record.new.id,
				players: [player],
			}),
		);
	}

	for (const [_entityId, node, _sound] of world.query(Components.Node, Components.Sound)) {
		if (game.IsAncestorOf(node.model)) {
			node.model.Parent = Workspace.Caches.Sound;
			soundEmitterCache.ReturnPart(node.model as ObjectCachePart<typeof soundEmitterCache>);
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;

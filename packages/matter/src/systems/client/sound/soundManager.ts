import type { ClientState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type ObjectCache from "@rbxts/object-cache";
import { Workspace } from "@rbxts/services";

import { Components } from "../../../components";
import { recordNodeReturned } from "../../../debug/soundDebugStats";
import type { placeAudioToModel } from "../../../utils/sound";
import { soundEmitterCache } from "../../../utils/sound";

type ObjectCachePart<T> = T extends ObjectCache<infer U> ? U : never;

function system(world: World): void {
	for (const [entityId, record] of world.queryChanged(Components.Sound)) {
		if (record.old || !record.new || record.new.local) {
			continue;
		}

		const node = world.get(entityId, Components.Node)?.model as ReturnType<
			typeof placeAudioToModel
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

	for (const [_entityId, record] of world.queryChanged(Components.Sound)) {
		if (record.new || !record.old || !record.old.emitter || !game.IsAncestorOf(record.old.emitter)) {
			continue;
		}

		const node = record.old.emitter.Parent!.Parent!
		node.Parent = Workspace.Caches.Sound;
		soundEmitterCache.ReturnPart(node as ObjectCachePart<typeof soundEmitterCache>);
		recordNodeReturned();
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;

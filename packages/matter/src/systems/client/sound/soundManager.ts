import type { ClientState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";

import { Components } from "../../../components";
import {
	assembleSoundComponent,
	getNodeFromEmitter,
	recycleAudioNode,
} from "../../../utils/audioEmitter";
import type { AudioEmitterNode } from "../../../utils/audioEmitter";

function system(world: World): void {
	for (const [entityId, record] of world.queryChanged(Components.Sound)) {
		if (record.old || !record.new || record.new.local) {
			continue;
		}

		const node = world.get(entityId, Components.Node)?.model as N<AudioEmitterNode>;
		if (node === undefined) {
			continue;
		}

		world.insert(entityId, Components.Sound(assembleSoundComponent(node, record.new.id)));
	}

	for (const [_entityId, record] of world.queryChanged(Components.Sound)) {
		if (
			record.new ||
			!record.old ||
			!record.old.emitter ||
			!game.IsAncestorOf(record.old.emitter)
		) {
			continue;
		}

		const node = getNodeFromEmitter(record.old.emitter);
		if (node !== undefined) {
			recycleAudioNode(node);
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;

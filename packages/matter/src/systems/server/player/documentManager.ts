/*
 * This system synchronizes changes to player components like Hotbar's and
 * Inventories with persistent storage. It updates player documents to reflect
 * the current state of their in-game items. It ensures data consistency between
 * the server and player records.
 */
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { ChangeRecord, ComponentKey, Components, getComponent } from "../../../components";
import { ServerState, store } from "@lisachandra/core/out/store";
import { catcher } from "@lisachandra/core/out/utils/main";
import { is } from "@lisachandra/core/out/utils/type";
import { useDocument } from "../../../hooks/useDocument";
import { getDocumentConfig } from "../../../start";

/*
 * Synchronizes component changes (e.g., Hotbar, Inventory) with the player's
 * saved documents.
 */
function updateDocument(
	discriminator: string,
	document: ReturnType<typeof useDocument>["document"],
	component: "Hotbar" | "Inventory",
	record: Required<ChangeRecord<Components["Hotbar"] | Components["Inventory"]>>,
): void {
	if (!document) {
		return;
	}

	const data = document.read();
	const dataKey = component.lower() as Lowercase<typeof component>;

	const newItems = table.clone(data[dataKey]);

	for (const index of $range(0, record.new.items.size() - 1)) {
		const item = record.new.items[index]!;
		newItems[index] = {
			amount: item.amount,
			data: item.data,
			guid: item.guid,
			id: item.id,
		};
	}

	store.server
		.update({
			documents: (documents) => {
				return {
					...documents,
					[discriminator]: { ...data, [dataKey]: newItems },
				};
			},
		})
		.catch(catcher);
}

function system(world: World): void {
	const documentConfig = getDocumentConfig();
	const collection = documentConfig?.collection;
	if (collection === undefined) {
		return;
	}

	const persistedComponents = documentConfig?.persistedComponents ?? {
		Hotbar: "hotbar",
		Inventory: "inventory",
	};

	for (const [componentName, _dataKey] of pairs(persistedComponents)) {
		const componentConst = getComponent(componentName as ComponentKey)
		if (componentConst === undefined) {
			continue;
		}

		for (const [entityId, record] of world.queryChanged(componentConst as never)) {
			if (
				!record.old ||
				!record.new ||
				!is<Required<ChangeRecord<Components["Hotbar"] | Components["Inventory"]>>>(record)
			) {
				continue;
			}

			const profile = world.get(entityId, getComponent("Profile"));
			const { discriminator, document } = profile
				? useDocument(collection, profile.player.UserId)
				: { discriminator: undefined, document: undefined };

			if (discriminator === undefined || !document) {
				continue;
			}

			updateDocument(discriminator, document, componentName as "Hotbar" | "Inventory", record);
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;

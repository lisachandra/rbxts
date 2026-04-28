/*
 * This system handles the synchronization of player and NPC hotbar's with their
 * equipped tools. It ensures the correct tool is equipped and manages tool
 * interactions, such as adding and removing tools. It provides seamless
 * integration of hotbar updates during gameplay.
 */
import type { Crate } from "@rbxts/crate";
import type { AnyEntity, Component, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { None, useEvent } from "@rbxts/matter";

import { meta as toolManager } from "./toolManager";
import { Components, getComponent } from "../../../components";
import { getItemFromGUID } from "../../../utils/item";
import { Character } from "@lisachandra/core/out/schemas";
import { getEntityHumanoid } from "../../../utils/entity";
import { ServerState } from "@lisachandra/core/out/store";

function handleToolEquip(
	world: World,
	entityId: AnyEntity,
	character: Character,
	tool: Tool,
): void {
	task.spawn(() => {
		const toolGrip = character.Torso.WaitForChild("ToolGrip", 1);
		if (
			toolGrip === undefined ||
			!toolGrip.IsA("Motor6D") ||
			character.FindFirstChildWhichIsA("Tool") !== tool
		) {
			return;
		}

		toolGrip.Part1 = tool.FindFirstChild<BasePart>("Attach");
	});

	const item = getItemFromGUID(tool.GetAttribute<string>("guid")!);

	const hotbar = world.get(entityId, getComponent("Hotbar"));
	if (hotbar) {
		world.insert(entityId, hotbar.patch({ equipped: item!.guid }));
	}
}

function handleToolUnequip(world: World, entityId: AnyEntity, tool: Instance): void {
	if (!tool.IsA("Tool")) {
		return;
	}

	const hotbar = world.get(entityId, getComponent("Hotbar"));
	const removedToolGUID = tool.GetAttribute<string>("guid");

	if (hotbar && removedToolGUID !== undefined && hotbar.equipped === removedToolGUID) {
		world.insert(entityId, hotbar.patch({ equipped: None }));
	}
}

function didHotbarInitialize(
	world: World,
	entityId: AnyEntity,
	hotbar: Component<Components["Hotbar"]>,
): void {
	if (hotbar.equipped === undefined) {
		world.insert(entityId, hotbar.patch({ equipped: hotbar.items[0]?.guid }));
	}
}

/*
 * Synchronizes the hotbar's equipped item with in-game tools and updates state
 * accordingly.
 */
function system(world: World): void {
	for (const [entityId, hotbar] of world.query(getComponent("Hotbar"))) {
		didHotbarInitialize(world, entityId, hotbar);

		const humanoid = getEntityHumanoid(entityId);
		if (!humanoid) {
			continue;
		}

		for (const [_, tool] of useEvent(humanoid.Parent, "ChildAdded")) {
			if (!tool.IsA("Tool")) {
				continue;
			}

			handleToolEquip(world, entityId, humanoid.Parent, tool);
			break;
		}

		for (const [_, tool] of useEvent(humanoid.Parent, "ChildRemoved")) {
			handleToolUnequip(world, entityId, tool);
		}
	}
}

export const meta = {
	after: [toolManager],
	phase: "preAnimation",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;

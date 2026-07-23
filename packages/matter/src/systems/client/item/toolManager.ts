/*
 * This system manages the tools equipped in the player's hotbar. It handles
 * equipping, unequipping, and visibility adjustments for tools based on user
 * input. It ensures that the correct tools are equipped and synchronized with
 * the player's actions.
 *
 * Instead of being locked to a specific input library (e.g., @rbxts/gamejoy),
 * this system uses the configurable `InputAdapter` from `start.ts`. Users can
 * supply their own adapter via `configureRuntimeAdapters`. If no adapter is
 * provided, the system falls back to detecting numeric key presses (1-9, 0)
 * directly via `UserInputService`.
 */
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct } from "@rbxts/matter";
import type { AnyEntity, World } from "@rbxts/matter";
import { useEvent } from "@rbxts/matter";
import { Players, UserInputService } from "@rbxts/services";
import { Components } from "../../../components";
import { getItemFromGUID } from "../../../utils/item";
import { Humanoid } from "@lisachandra/core/schemas";
import { ClientState } from "@lisachandra/core/store";
import { getHumanoid } from "@lisachandra/core/utils/main";
import { getHotbarInputAdapter } from "../../../start";
import { meta as itemManager } from "../item/itemManager";

/**
 * Map of numeric keycodes to their corresponding hotbar slot index.
 */
const numericKeyToIndex = new Map<Enum.KeyCode, number>([
	[Enum.KeyCode.One, 0],
	[Enum.KeyCode.Two, 1],
	[Enum.KeyCode.Three, 2],
	[Enum.KeyCode.Four, 3],
	[Enum.KeyCode.Five, 4],
	[Enum.KeyCode.Six, 5],
	[Enum.KeyCode.Seven, 6],
	[Enum.KeyCode.Eight, 7],
	[Enum.KeyCode.Nine, 8],
	[Enum.KeyCode.Zero, 9],
]);

/**
 * The number of hotbar slots per row.
 */
const slotsPerRow = 10;

function equipTool(humanoid: Humanoid, hotbar: Components["Hotbar"]): void {
	const order = hotbar.order ?? hotbar.items.map((item) => item.guid);
	const adapter = getHotbarInputAdapter();

	let index = -1;

	if (adapter) {
		// Use the configured input adapter.
		const heldKeys = adapter.getHeldKeys();
		for (const key of heldKeys) {
			const slotIndex = numericKeyToIndex.get(key);
			if (slotIndex !== undefined) {
				index = slotIndex;
				break;
			}
		}

		// Handle shift modifier for second row if shift is held.
		if (
			index !== -1 &&
			(heldKeys.includes(Enum.KeyCode.LeftShift) ||
				heldKeys.includes(Enum.KeyCode.RightShift))
		) {
			index += slotsPerRow;
		}
	} else {
		// Fallback: detect numeric key presses directly.
		for (const [keyCode, slotIndex] of pairs(numericKeyToIndex)) {
			if (UserInputService.IsKeyDown(keyCode)) {
				index = slotIndex;
				break;
			}
		}

		if (
			index !== -1 &&
			(UserInputService.IsKeyDown(Enum.KeyCode.LeftShift) ||
				UserInputService.IsKeyDown(Enum.KeyCode.RightShift))
		) {
			index += slotsPerRow;
		}
	}

	const guid = index !== -1 ? order[index] : undefined;
	if (guid === undefined) {
		return;
	}

	for (const item of hotbar.items) {
		if (item.guid !== guid || !item.tool) {
			continue;
		}

		if (item.tool.Parent === humanoid.Parent) {
			humanoid.UnequipTools();
			return;
		}

		item.tool.Parent = Players.LocalPlayer.FindFirstChildWhichIsA("Backpack")!;
		humanoid.EquipTool(item.tool);
		return;
	}
}

function syncEquippedTool(hotbar: Components["Hotbar"], humanoid?: Humanoid): void {
	if (!humanoid) {
		return;
	}

	const character = humanoid.Parent;
	const toolInHumanoid = character.FindFirstChildWhichIsA("Tool");

	if (hotbar.equipped === undefined) {
		if (toolInHumanoid) {
			humanoid.UnequipTools();
		}

		return;
	}

	const equippedTool = getItemFromGUID(hotbar.equipped)?.tool;
	const toolGrip = character.Torso.FindFirstChild<Motor6D>("ToolGrip");

	if (equippedTool && !toolInHumanoid) {
		equippedTool.Parent = Players.LocalPlayer.FindFirstChildWhichIsA("Backpack")!;
		humanoid.EquipTool(equippedTool);
	}

	if (equippedTool && equippedTool === toolInHumanoid && toolGrip) {
		toolGrip.Part1 = equippedTool.FindFirstChild<BasePart>("Attach");
	}
}

/*
 * Manages the tools in the player's hotbar, handling equipping and visibility.
 * Automatically equips the correct tool based on user input. Handles hotbar
 * input (e.g., number key presses) to equip corresponding tools. Synchronizes
 * humanoid tool states with the hotbar's equipped item.
 *
 * If an `InputAdapter` is configured via `configureRuntimeAdapters`, it will
 * be used for input detection. Otherwise, the system falls back to polling
 * `UserInputService` for numeric key presses each frame.
 */
function system(world: World, crate: Crate<ClientState>): void {
	if (!crate.getState("playerEntityId")) {
		return;
	}

	const clientEntityId = crate.getState("playerEntityId")! as AnyEntity;
	const hotbar = world.get(clientEntityId, Components.Hotbar)!;
	const humanoid = getHumanoid(Players.LocalPlayer);

	syncEquippedTool(hotbar, humanoid);

	const adapter = getHotbarInputAdapter();
	if (adapter) {
		// Use the configured input adapter to listen for key presses.
		for (const [_, key] of useEvent(UserInputService, "InputBegan")) {
			if (!humanoid || key.UserInputType !== Enum.UserInputType.Keyboard) {
				continue;
			}
			const keyCode = key.KeyCode;
			const slotIndex = numericKeyToIndex.get(keyCode);
			if (slotIndex === undefined) {
				continue;
			}
			equipTool(humanoid, hotbar);
		}
	}
}

export const meta = {
	after: [itemManager],
	phase: "preRender",
	system,
} satisfies SystemStruct<[World, Crate<ClientState>, DebugWidgets]>;

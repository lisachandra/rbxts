import { vector } from "@lisachandra/core";
import { Components} from "@lisachandra/matter";
import type { AnyEntity, World } from "@rbxts/matter";
import { Workspace } from "@rbxts/services";
import type { PlotStage, ResourceKind } from "shared/game/types";

export function ensureGardenFolder(): Folder {
	const existing = Workspace.Maps.FindFirstChild<Folder>("GardenScraps");
	if (existing) {
		return existing;
	}

	const folder = new Instance("Folder");
	folder.Name = "GardenScraps";
	folder.Parent = Workspace.Maps;
	return folder;
}

export function createGardenPart(
	folder: Folder,
	name: string,
	position: Vector3,
	size: Vector3,
	color: Color3,
): Part {
	const part = new Instance("Part");
	part.Name = name;
	part.Anchored = true;
	part.CanCollide = true;
	part.Material = Enum.Material.SmoothPlastic;
	part.Size = size;
	part.Position = position;
	part.Color = color;
	part.Parent = folder;
	return part;
}

export function applyPlotVisual(part: BasePart, stage: PlotStage): void {
	part.SetAttribute("gardenStage", stage);
	part.SetAttribute("markerLabel", stage === "Grown" ? "Harvest ready" : stage === "Dirty" ? "Needs scrap" : stage === "Cleared" ? "Needs seed" : stage === "Planted" ? "Needs water" : "Growing");

	switch (stage) {
		case "Dirty":
			part.Color = Color3.fromRGB(101, 67, 33);
			break;
		case "Cleared":
			part.Color = Color3.fromRGB(145, 110, 70);
			break;
		case "Planted":
			part.Color = Color3.fromRGB(86, 125, 70);
			break;
		case "Watered":
			part.Color = Color3.fromRGB(64, 110, 191);
			break;
		case "Grown":
			part.Color = Color3.fromRGB(83, 185, 98);
			break;
	}
}

export function applyPickupVisual(part: BasePart, kind: ResourceKind, active: boolean): void {
	part.SetAttribute("resourceKind", kind);
	part.SetAttribute("markerLabel", active ? kind : "");
	part.Transparency = active ? 0 : 1;
	part.CanCollide = active;

	switch (kind) {
		case "Scrap":
			part.Color = Color3.fromRGB(163, 162, 165);
			break;
		case "Seed":
			part.Color = Color3.fromRGB(217, 180, 72);
			break;
		case "Water":
			part.Color = Color3.fromRGB(90, 170, 255);
			break;
		case "Harvest":
			part.Color = Color3.fromRGB(95, 213, 64);
			break;
	}
}

export function applyWaterVisual(part: BasePart): void {
	part.Color = Color3.fromRGB(90, 170, 255);
	part.SetAttribute("markerLabel", "Water source");
}

export function getCharacterRoot(player: Player): BasePart | undefined {
	return player.Character?.FindFirstChild<BasePart>("HumanoidRootPart");
}

export function isWithinRadius(position: Vector3, target: BasePart, radius: number): boolean {
	return vector.distance(position, target.Position) <= radius;
}

export function setCarryState(world: World, entityId: AnyEntity, kind: ResourceKind | undefined, amount: number): void {
	world.insert(entityId, Components.CarryState({ kind, amount }));
}

export function setPromptState(world: World, entityId: AnyEntity, text: string): void {
	world.insert(entityId, Components.PromptState({ text }));
}

export function pushNotification(world: World, entityId: AnyEntity, latest: string): void {
	const current = world.get(entityId, Components.NotificationState);
	world.insert(
		entityId,
		Components.NotificationState({
			latest,
			revision: (current?.revision ?? 0) + 1,
		}),
	);
}

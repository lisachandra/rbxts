import { registerComponent, registry, type Components } from "@lisachandra/matter";
import { component } from "@rbxts/matter";
import type { PlotStage, PromptKind, ResourceKind } from "shared/game/types";

declare module "@lisachandra/matter/out/components" {
	interface Components {
		GardenPlot: {
			plotId: string;
			part: BasePart;
			stage: PlotStage;
			progress: number;
			lastTouchedAt: number;
		};
		ResourcePickup: {
			part: BasePart;
			kind: ResourceKind;
			amount: number;
			respawnAt?: number;
		};
		Interactable: {
			part: BasePart;
			prompt: string;
			radius: number;
			kind: PromptKind;
		};
		GardenProgress: {
			restoredPlots: number;
			totalPlots: number;
			harvested: number;
			health: number;
		};
		CarryState: {
			kind?: ResourceKind;
			amount: number;
		};
		PromptState: {
			text: string;
		};
		NotificationState: {
			latest: string;
			revision: number;
		};
		WaterSource: {
			part: BasePart;
			uses: number;
		};
		DecayState: {
			nextDecayAt: number;
		};
	}
}

const gardenPlot = component<Components["GardenPlot"]>("GardenPlot");
const resourcePickup = component<Components["ResourcePickup"]>("ResourcePickup");
const interactable = component<Components["Interactable"]>("Interactable");
const gardenProgress = component<Components["GardenProgress"]>("GardenProgress", {
	restoredPlots: 0,
	totalPlots: 0,
	harvested: 0,
	health: 0,
});
const carryState = component<Components["CarryState"]>("CarryState", { amount: 0 });
const promptState = component<Components["PromptState"]>("PromptState", { text: "Walk near a pickup." });
const notificationState = component<Components["NotificationState"]>("NotificationState", { latest: "", revision: 0 });
const waterSource = component<Components["WaterSource"]>("WaterSource");
const decayState = component<Components["DecayState"]>("DecayState");

registerComponent("GardenPlot", gardenPlot);
registerComponent("ResourcePickup", resourcePickup);
registerComponent("Interactable", interactable);
registerComponent("GardenProgress", gardenProgress);
registerComponent("CarryState", carryState);
registerComponent("PromptState", promptState);
registerComponent("NotificationState", notificationState);
registerComponent("WaterSource", waterSource);
registerComponent("DecayState", decayState);

registry.register<Components["GardenProgress"], Components["GardenProgress"]>({
	component: gardenProgress,
	mode: "all",
	deserializer: (data) => data,
	serializer: (record) => record.new,
});

registry.register<Components["CarryState"], Components["CarryState"]>({
	component: carryState,
	mode: "owner",
	deserializer: (data) => data,
	serializer: (record) => record.new,
});

registry.register<Components["PromptState"], Components["PromptState"]>({
	component: promptState,
	mode: "owner",
	deserializer: (data) => data,
	serializer: (record) => record.new,
});

registry.register<Components["NotificationState"], Components["NotificationState"]>({
	component: notificationState,
	mode: "owner",
	deserializer: (data) => data,
	serializer: (record) => record.new,
});

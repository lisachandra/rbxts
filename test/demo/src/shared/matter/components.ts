import { Components, registry } from "@lisachandra/matter";
import { component } from "@rbxts/matter";

import type { PlotStage, PromptKind, ResourceKind } from "shared/game/types";

declare module "@lisachandra/matter/components" {
	interface Components {
		CarryState: {
			amount: number;
			kind?: ResourceKind;
		};
		DecayState: {
			nextDecayAt: number;
		};
		GardenPlot: {
			lastTouchedAt: number;
			part: BasePart;
			plotId: string;
			progress: number;
			stage: PlotStage;
		};
		GardenProgress: {
			harvested: number;
			health: number;
			restoredPlots: number;
			totalPlots: number;
		};
		Interactable: {
			kind: PromptKind;
			part: BasePart;
			prompt: string;
			radius: number;
		};
		NotificationState: {
			latest: string;
			revision: number;
		};
		PromptState: {
			text: string;
		};
		ResourcePickup: {
			amount: number;
			kind: ResourceKind;
			part: BasePart;
			respawnAt?: number;
		};
		WaterSource: {
			part: BasePart;
			uses: number;
		};
	}
}

const gardenPlot = component<Components["GardenPlot"]>("GardenPlot");
const resourcePickup = component<Components["ResourcePickup"]>("ResourcePickup");
const interactable = component<Components["Interactable"]>("Interactable");
const gardenProgress = component<Components["GardenProgress"]>("GardenProgress", {
	harvested: 0,
	health: 0,
	restoredPlots: 0,
	totalPlots: 0,
});
const carryState = component<Components["CarryState"]>("CarryState", { amount: 0 });
const promptState = component<Components["PromptState"]>("PromptState", {
	text: "Walk near a pickup.",
});
const notificationState = component<Components["NotificationState"]>("NotificationState", {
	latest: "",
	revision: 0,
});
const waterSource = component<Components["WaterSource"]>("WaterSource");
const decayState = component<Components["DecayState"]>("DecayState");

Components.GardenPlot = gardenPlot;
Components.ResourcePickup = resourcePickup;
Components.Interactable = interactable;
Components.GardenProgress = gardenProgress;
Components.CarryState = carryState;
Components.PromptState = promptState;
Components.NotificationState = notificationState;
Components.WaterSource = waterSource;
Components.DecayState = decayState;

registry.register<Components["GardenProgress"], Components["GardenProgress"]>({
	component: gardenProgress,
	deserializer: (data) => data,
	mode: "all",
	serializer: (record) => record.new,
});

registry.register<Components["CarryState"], Components["CarryState"]>({
	component: carryState,
	deserializer: (data) => data,
	mode: "owner",
	serializer: (record) => record.new,
});

registry.register<Components["PromptState"], Components["PromptState"]>({
	component: promptState,
	deserializer: (data) => data,
	mode: "owner",
	serializer: (record) => record.new,
});

registry.register<Components["NotificationState"], Components["NotificationState"]>({
	component: notificationState,
	deserializer: (data) => data,
	mode: "owner",
	serializer: (record) => record.new,
});

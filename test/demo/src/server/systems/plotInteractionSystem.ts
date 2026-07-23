import type { Crate } from "@rbxts/crate";
import type { AnyEntity, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type { ServerState } from "@lisachandra/core/store";
import { vector } from "@lisachandra/core";
import { Components} from "@lisachandra/matter";
import { GARDEN_DECAY_TIME, GARDEN_INTERACTION_RADIUS } from "shared/game/constants";
import { advancePlotStage } from "shared/game/helpers";
import { applyPlotVisual, getCharacterRoot, pushNotification, setCarryState, setPromptState } from "server/game/helpers";

function getProgressEntity(world: World): AnyEntity | undefined {
	for (const [entityId] of world.query(Components.GardenProgress)) {
		return entityId;
	}

	return undefined;
}

function system(world: World): void {
	const now = os.clock();
	const progressEntity = getProgressEntity(world);

	for (const [entityId, profile] of world.query(Components.Profile)) {
		const root = getCharacterRoot(profile.player);
		if (!root) {
			continue;
		}

		const carry = world.get(entityId, Components.CarryState);
		let bestPrompt = "Walk near Scrap, Seed, Water, or a Plot";
		let bestDistance = math.huge;

		for (const [, water] of world.query(Components.WaterSource)) {
			const dist = vector.distance(root.Position, water.part.Position);
			if (dist < bestDistance) {
				bestDistance = dist;
				bestPrompt = carry?.amount ? "Use your current resource on a plot" : "Collect water";
			}

			if ((carry?.amount ?? 0) === 0 && dist <= GARDEN_INTERACTION_RADIUS) {
				setCarryState(world, entityId, "Water", 1);
				pushNotification(world, entityId, "Collected water");
				setPromptState(world, entityId, "Water collected");
				world.commitCommands();
				continue;
			}
		}

		for (const [plotEntity, plot] of world.query(Components.GardenPlot)) {
			const dist = vector.distance(root.Position, plot.part.Position);
			if (dist < bestDistance) {
				bestDistance = dist;
				bestPrompt = plot.part.GetAttribute<string>("markerLabel") ?? bestPrompt;
			}

			if (dist > GARDEN_INTERACTION_RADIUS) {
				continue;
			}

			if (plot.stage === "Grown") {
				applyPlotVisual(plot.part, "Dirty");
				world.insert(
					plotEntity,
					Components.GardenPlot({
						...plot,
						stage: "Dirty",
						lastTouchedAt: now,
						progress: 0,
					}),
				);
				world.insert(plotEntity, Components.DecayState({ nextDecayAt: now + GARDEN_DECAY_TIME }));
				if (progressEntity !== undefined) {
					const progress = world.get(progressEntity, Components.GardenProgress);
					if (progress) {
						world.insert(progressEntity, Components.GardenProgress({ ...progress, harvested: progress.harvested + 1 }));
					}
				}
				pushNotification(world, entityId, "Harvest collected");
				setPromptState(world, entityId, "Harvested plant");
				world.commitCommands();
				continue;
			}

			if (!carry?.kind || carry.amount <= 0) {
				continue;
			}

			const nextStage = advancePlotStage(plot.stage, carry.kind);
			if (nextStage === plot.stage) {
				continue;
			}

			applyPlotVisual(plot.part, nextStage);
			world.insert(
				plotEntity,
				Components.GardenPlot({
					...plot,
					stage: nextStage,
					lastTouchedAt: now,
					progress: nextStage === "Watered" ? 1 : plot.progress,
				}),
			);
			world.insert(plotEntity, Components.DecayState({ nextDecayAt: now + GARDEN_DECAY_TIME }));
			setCarryState(world, entityId, undefined, 0);
			pushNotification(world, entityId, `${carry.kind} used on plot`);
			setPromptState(world, entityId, plot.part.GetAttribute<string>("markerLabel") ?? "Plot updated");
			world.commitCommands();
		}

		setPromptState(world, entityId, bestPrompt);
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;

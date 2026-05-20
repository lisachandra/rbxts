import type { PlotStage, ResourceKind } from "./types";

export function advancePlotStage(stage: PlotStage, resource: ResourceKind): PlotStage {
	if (stage === "Dirty" && resource === "Scrap") {
		return "Cleared";
	}

	if (stage === "Cleared" && resource === "Seed") {
		return "Planted";
	}

	if (stage === "Planted" && resource === "Water") {
		return "Watered";
	}

	return stage;
}

export function regressPlotStage(stage: PlotStage): PlotStage {
	if (stage === "Watered") {
		return "Planted";
	}

	if (stage === "Planted") {
		return "Cleared";
	}

	if (stage === "Cleared") {
		return "Dirty";
	}

	return stage;
}

export function isRestoredPlot(stage: PlotStage): boolean {
	return stage !== "Dirty";
}

export function computeGardenCompletion(restoredPlots: number, totalPlots: number): number {
	if (totalPlots <= 0) {
		return 0;
	}

	return restoredPlots / totalPlots;
}

export function computeGardenHealth(restoredPlots: number, totalPlots: number): number {
	return computeGardenCompletion(restoredPlots, totalPlots);
}

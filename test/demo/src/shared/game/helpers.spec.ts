import { describe, expect, it } from "@rbxts/jest-globals";
import { advancePlotStage, computeGardenCompletion, regressPlotStage } from "shared/game/helpers";

describe("garden helpers", () => {
	it("progresses a plot in the correct order", () => {
		expect(advancePlotStage("Dirty", "Scrap")).toBe("Cleared");
		expect(advancePlotStage("Cleared", "Seed")).toBe("Planted");
		expect(advancePlotStage("Planted", "Water")).toBe("Watered");
	});

	it("does not allow invalid transitions", () => {
		expect(advancePlotStage("Dirty", "Seed")).toBe("Dirty");
		expect(advancePlotStage("Cleared", "Water")).toBe("Cleared");
	});

	it("regresses neglected plots", () => {
		expect(regressPlotStage("Watered")).toBe("Planted");
		expect(regressPlotStage("Planted")).toBe("Cleared");
	});

	it("computes completion from restored plots", () => {
		expect(computeGardenCompletion(3, 6)).toBe(0.5);
	});
});

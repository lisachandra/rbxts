import { describe, expect, it } from "@rbxts/jest-globals";

import { advancePlotStage, computeGardenCompletion, regressPlotStage } from "shared/game/helpers";

describe("garden helpers", () => {
	it("should progress a plot in the correct order", () => {
		expect.assertions(3);
		expect(advancePlotStage("Dirty", "Scrap")).toBe("Cleared");
		expect(advancePlotStage("Cleared", "Seed")).toBe("Planted");
		expect(advancePlotStage("Planted", "Water")).toBe("Watered");
	});

	it("should not allow invalid transitions", () => {
		expect.assertions(2);
		expect(advancePlotStage("Dirty", "Seed")).toBe("Dirty");
		expect(advancePlotStage("Cleared", "Water")).toBe("Cleared");
	});

	it("should regress neglected plots", () => {
		expect.assertions(2);
		expect(regressPlotStage("Watered")).toBe("Planted");
		expect(regressPlotStage("Planted")).toBe("Cleared");
	});

	it("should compute completion from restored plots", () => {
		expect.assertions(1);
		expect(computeGardenCompletion(3, 6)).toBe(0.5);
	});
});

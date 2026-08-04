import { describeEachReactMode } from "@lisachandra/test";
import { expect, test } from "@rbxts/jest-globals";
import React from "@rbxts/react";

import { App } from "client/ui/app";

describeEachReactMode("GardenScraps App", ({ render }) => {
	// oxlint-disable-next-line jest-js/require-top-level-describe -- describeEachReactMode wraps a describe
	test("should render the gameplay HUD", () => {
		expect.assertions(3);

		const result = render(<App />);

		expect(result.getByText("Garden Health")).toBeDefined();
		expect(result.getByText("Carrying")).toBeDefined();
		expect(result.getByText("Welcome to Garden Scraps")).toBeDefined();
	});
});

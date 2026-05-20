import { describe, expect, it } from "@rbxts/jest-globals";
import React from "@rbxts/react";
import { describeEachReactMode } from "@lisachandra/test";
import { App } from "client/ui/app";

describeEachReactMode("GardenScraps App", ({ render }) => {
	it("renders the gameplay HUD", () => {
		const result = render(<App />);
		expect(result.getByText("Garden Health")).toBeDefined();
		expect(result.getByText("Carrying")).toBeDefined();
		expect(result.getByText("Welcome to Garden Scraps")).toBeDefined();
	});
});

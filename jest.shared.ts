import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	backend: "open-cloud",
	gameOutput: "game-output.log",
	jestPath: "ReplicatedStorage/TS/node_modules/@rbxts/jest/src",
	outputFile: "jest-output.log",
	placeFile: "test.rbxl",
	test: {
		clearMocks: true,
		collectCoverage: true,
		coveragePathIgnorePatterns: ["**/*.spec.ts", "**/*.spec.tsx"],
		mockDataModel: false,
		runInBand: true,
		setupFiles: ["@lisachandra/test/setup"],
		testTimeout: 30_000,
	},
	timeout: 300_000,
});

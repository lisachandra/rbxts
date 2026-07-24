import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	backend: "studio-cli",
	gameOutput: "game-output.log",
	jestPath: "ReplicatedStorage/TS/node_modules/@rbxts/jest/src",
	outputFile: "jest-output.log",
	placeFile: "test.rbxl",
	timeout: 60_000,
	test: {
		clearMocks: true,
		collectCoverage: true,
		coveragePathIgnorePatterns: ["**/*.spec.ts", "**/*.spec.tsx"],
		mockDataModel: false,
		runInBand: true,
		testTimeout: 30_000,
		setupFiles: ["@lisachandra/test/setup"],
	},
});

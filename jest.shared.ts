import { defineConfig } from "@isentinel/jest-roblox";

const isCi = process.env["CI"] !== undefined && process.env["CI"] !== "";

export default defineConfig({
	backend: isCi ? "open-cloud" : "studio-cli",
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
		testTimeout: isCi ? 600_000 : 300_000,
	},
	timeout: isCi ? 600_000 : 300_000,
});

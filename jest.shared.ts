import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	backend: "open-cloud",
	clearMocks: true,
	coveragePathIgnorePatterns: ["**/test/**", "**/index.ts"],
	gameOutput: "game-output.log",
	jestPath: "ReplicatedStorage/rbxts_include/node_modules/@rbxts/jest/src",
	outputFile: "jest-output.log",
	placeFile: "test.rbxl",
	rojoProject: "default.project.json",
	setupFiles: ["@lisachandra/core/out/test/setup"],
	testTimeout: 5000,
	timeout: 30000,
});

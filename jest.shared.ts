import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	backend: "open-cloud",
	clearMocks: true,
	collectCoverage: true,
	coveragePathIgnorePatterns: ["**/test/**", "**/index.ts"],
	gameOutput: "game-output.log",
	jestPath: "ReplicatedStorage/rbxts_include/node_modules/@rbxts/jest/src",
	outputFile: "jest-output.log",
	placeFile: "test.rbxl",
	rojoProject: "default.project.json",
	testTimeout: 5000,
	timeout: 30000,
	typecheck: true,
});

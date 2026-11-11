import { defineConfig } from "@isentinel/jest-roblox";

/*
 * Specs the emulator lane cannot run yet — ree parity gaps, each with a
 * captured failure signature in docs/agents/offline-runtime-spike.md.
 *
 * NOTE FOR AGENTS:
 * Implementing spec that fails on Roblox engine gap (ree parity)? Add the spec
 * path here with a one-line comment naming what ree does not do.
 */
const reeParityPaths: Array<string> = [];

export default defineConfig({
	/*
	 * Default lane: the emulator backend stages each test workspace's compiled
	 * out/ tree and runs it inside ree — offline, no Studio roundtrip, no Roblox
	 * credentials. Parity gaps are listed in docs/agents/offline-runtime-spike.md.
	 */
	backend: "emulator",
	/*
	 * Service-named `.rbxm` bundles of the container folders each Rojo project
	 * declares; ree loads them before the mounts so the containers exist.
	 * `scripts/emulator/scaffold.mjs` generates them offline from each
	 * project's `default.project.json` (`pnpm ui:templates`) — no Studio place
	 * required. A bundle exported from a tester place wins over the scaffold,
	 * and a missing directory degrades to the harness's empty stubs.
	 */
	emulator: {
		ignorePatterns: [...reeParityPaths],
		reePath: "ree",
		reflectionPath: "../../scripts/emulator/reflection.json",
		seconds: 30,
		snapshotsDirectory: "build/ui-templates",
	},
	gameOutput: "game-output.log",
	jestPath: "ReplicatedStorage/TS/rbxts_include/node_modules/@rbxts/jest/src",
	outputFile: "jest-output.log",
	placeFile: "test.rbxl",
	test: {
		clearMocks: true,
		collectCoverage: true,
		coveragePathIgnorePatterns: ["**/*.spec.ts", "**/*.spec.tsx"],
		mockDataModel: false,
		runInBand: true,
		setupFiles: ["./node_modules/@lisachandra/test/out/setup"],
		testTimeout: 300_000,
	},
	timeout: 300_000,
});

import { defineConfig } from "@isentinel/jest-roblox";

/*
 * Specs the emulator lane cannot run yet — ree parity gaps, each with a
 * captured failure signature in docs/agents/offline-runtime-spike.md.
 *
 * NOTE FOR AGENTS:
 * Implementing spec that fails on Roblox engine gap (ree parity)? Add the spec
 * path here with a one-line comment naming what ree does not do.
 *
 * These are **DataModel paths**, not checkout paths: `emulator.ignorePatterns`
 * is matched against the staged tree, where each `test/*` project's compiled
 * `out/` sits at `ReplicatedStorage/TS/tests` and the compiler flattens `src/`
 * into it. So `test/core/src/utils.spec.ts` is `tests/utils.spec`, and a
 * repo-relative path never matches — silently, which is how the whole ledger
 * went unregistered. `test/demo` mounts under `TS/client` / `TS/shared`
 * instead of `TS/tests`, so its entries follow that shape.
 */
const reeParityPaths: Array<string> = [
	/*
	 * ree boots a client context (`RunService:IsServer()` is false in every
	 * mode), so the server-only `waitForDocument` guard aborts the suite.
	 */
	"tests/utils.spec", // test/core/src/utils.spec.ts
	"tests/store.spec", // test/core/src/store.spec.ts — `documents` middleware is server-only
	"tests/documentCommand.spec", // test/platform/src/documentCommand.spec.ts — calls waitForDocument
	// ree has no Matter world; only a bootstrap creates one, and the spec never runs one.
	"client/ui/app.spec", // test/demo/src/client/ui/app.spec.tsx
];

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
		/*
		 * `test/react-router`, `test/react-template`, and `test/types` carry a project but no specs
		 * yet, and jest exits 1 on "No test files found". Without this, `pnpm test` — the command the
		 * repo documents as its aggregate check — is red on a clean `main`, which makes it useless
		 * as a signal. A lane that gains a spec still runs it; the flag only tolerates zero.
		 */
		passWithNoTests: true,
		runInBand: true,
		setupFiles: ["@lisachandra/test/setup"],
		testTimeout: 300_000,
	},
	timeout: 300_000,
});

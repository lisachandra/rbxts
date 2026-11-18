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
		/*
		 * The universe the harness probes against. Left unset, the harness derives it from each
		 * project's `include` patterns — which name only the lane's own `src`, so every package the
		 * lane mounts through `node_modules/@lisachandra` was mirrored into the shadow with no
		 * probe placed, and
		 * no lane but `demo` reported anything. These globs name both halves the run actually
		 * executes: the lane's TypeScript and the mounted packages' TypeScript (their compiled
		 * `.luau` maps back to `node_modules/@lisachandra/<pkg>/src/**` through the sidecar the
		 * compiler ships). Vendor mounts (`@rbxts`, `@rbxts-js`) match neither glob and stay
		 * outside the probes, which is the scope a monorepo can ratchet a floor against.
		 */
		collectCoverageFrom: [
			"src/**/*.ts",
			"src/**/*.tsx",
			"node_modules/@lisachandra/*/src/**/*.ts",
			"node_modules/@lisachandra/*/src/**/*.tsx",
			/*
			 * `constant`, `constant-protocol` and `types` ship compiled output with no
			 * `.map` sidecar, so their candidates are the compiled paths themselves; a
			 * package left unmatched here is mirrored with no probes, and the demote that
			 * narrowing then runs leaves its `$path` pointing at a junction Rojo
			 * cannot mount.
			 */
			"node_modules/@lisachandra/*/out/**/*.luau",
		],
		coveragePathIgnorePatterns: ["**/*.spec.ts", "**/*.spec.tsx"],
		/*
		 * `json-summary` is what `pnpm coverage` reads, so the config writes it rather than leaving it
		 * to a CI flag. With the flag only, a local `pnpm test` wrote `lcov.info` and left the summary
		 * untouched, and `pnpm coverage` then passed its floors against whatever number an earlier
		 * instrumented run — or CI — had left behind. The gate has to read a report the run in front of
		 * it just wrote.
		 *
		 * `json` keeps the per-file detail the summary flattens; `lcov` is what editors consume; `text`
		 * is the number a developer reads in the terminal.
		 */
		coverageReporters: ["json", "json-summary", "lcov", "text"],
		mockDataModel: false,
		/*
		 * A lane with a project but no specs yet makes jest exit 1 on "No test files found", which
		 * turns `pnpm test` — the command the repo documents as its aggregate check — red on a clean
		 * `main` and so useless as a signal. Every lane that exists today has at least one spec; this
		 * stays as the guard for the next lane that is scaffolded before its first spec is written.
		 * A lane that has a spec still runs it; the flag only tolerates zero.
		 */
		passWithNoTests: true,
		runInBand: true,
		setupFiles: ["@lisachandra/test/setup"],
		testTimeout: 300_000,
	},
	timeout: 300_000,
});

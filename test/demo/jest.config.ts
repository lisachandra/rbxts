import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	jestPath: "ReplicatedStorage/TS/rbxts_include/node_modules/@rbxts/jest/src",
	test: {
		/*
		 * No `client` project: its only spec (`app.spec.tsx`) is listed in `jest.shared.ts`'s
		 * `reeParityPaths`, because rendering `<App />` needs a Matter world and a full DataModel
		 * that ree does not provide. A project whose every spec is a parity exclusion runs zero
		 * tests, and the runner exits 1 on "No test files found" — failing the lane for a correct
		 * exclusion. Re-add the project when a client-side spec can run offline; `apps.spec` stays
		 * registered in `reeParityPaths` until then.
		 */
		projects: [
			{
				test: {
					displayName: { color: "green", name: "shared" },
					include: ["src/shared/**/*.spec.ts", "src/shared/**/*.spec.tsx"],
					mockDataModel: false,
					outDir: "out/shared",
				},
			},
			{
				test: {
					displayName: { color: "magenta", name: "server" },
					include: ["src/server/**/*.spec.ts", "src/server/**/*.spec.tsx"],
					mockDataModel: false,
					outDir: "out/server",
				},
			},
		],
	},
});

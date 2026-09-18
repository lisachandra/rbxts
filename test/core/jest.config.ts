import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	test: {
		/*
		 * Replace the inherited shared setup (which cannot be resolved via the
		 * Node-side createRequire against the staged @lisachandra/test link) with
		 * a local compiled setup that sets _G.__TEST__.
		 */
		setupFiles: () => ["./out/setup"],
		projects: [
			{
				test: {
					displayName: { color: "magenta", name: "core" },
					include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
					mockDataModel: false,
					outDir: "out",
				},
			},
		],
	},
});

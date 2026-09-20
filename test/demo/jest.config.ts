import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	jestPath: "ReplicatedStorage/TS/rbxts_include/node_modules/@rbxts/jest/src",
	test: {
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
					displayName: { color: "blue", name: "client" },
					include: ["src/client/**/*.spec.ts", "src/client/**/*.spec.tsx"],
					mockDataModel: false,
					outDir: "out/client",
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

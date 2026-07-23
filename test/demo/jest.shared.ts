import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "./jest.shared.ts",
	setupFiles: ["@lisachandra/test/setup", "./out/test/setup"],
	projects: [
		{
			test: {
				displayName: { name: "shared", color: "green" },
				include: ["src/shared/**/*.spec.ts", "src/shared/**/*.spec.tsx"],
				mockDataModel: true,
				outDir: "out/shared",
			},
		},
		{
			test: {
				displayName: { name: "client", color: "blue" },
				include: ["src/client/**/*.spec.ts", "src/client/**/*.spec.tsx"],
				mockDataModel: true,
				outDir: "out/client",
			},
		},
		{
			test: {
				displayName: { name: "server", color: "magenta" },
				include: ["src/server/**/*.spec.ts", "src/server/**/*.spec.tsx"],
				mockDataModel: true,
				outDir: "out/server",
			},
		},
	],
});

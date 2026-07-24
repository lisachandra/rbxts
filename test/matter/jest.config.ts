import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	test: {
		projects: [
		{
			test: {
				displayName: { name: "matter", color: "cyan" },
				include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
				mockDataModel: false,
				outDir: "out",
			},
		},
	],
	},
});

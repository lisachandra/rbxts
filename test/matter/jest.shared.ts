import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	projects: [
		{
			test: {
				displayName: { name: "matter", color: "cyan" },
				include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
				mockDataModel: true,
				outDir: "out",
			},
		},
	],
});

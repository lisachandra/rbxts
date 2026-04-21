import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	projects: [
		{
			test: {
				displayName: { name: "ui", color: "blue" },
				include: ["**/*.spec.ts", "**/*.spec.tsx"],
				mockDataModel: true,
				outDir: "out-test",
			},
		},
	],
});

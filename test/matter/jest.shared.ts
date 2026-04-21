import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	projects: [
		{
			test: {
				displayName: { name: "matter", color: "cyan" },
				include: ["**/*.spec.ts", "**/*.spec.tsx"],
				mockDataModel: true,
				outDir: "out-test",
			},
		},
	],
});

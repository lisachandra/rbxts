import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	test: {
		projects: [
			{
				test: {
					displayName: { color: "white", name: "platform" },
					include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
					mockDataModel: false,
					outDir: "out",
				},
			},
		],
	},
});

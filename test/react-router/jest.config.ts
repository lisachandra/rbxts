import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	extends: "../../jest.shared.ts",
	test: {
		projects: [
			{
				test: {
					displayName: { color: "blue", name: "react-router" },
					include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
					mockDataModel: false,
					outDir: "out",
				},
			},
		],
	},
});

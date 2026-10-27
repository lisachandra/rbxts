import type { SandcastleUserConfig } from "@lisachandra/sandcastle";

const config: SandcastleUserConfig = {
	agents: {
		default: "zcode",
		enabled: ["zcode", "dirac", "pi"],
		/*
		 * zcode routes models as "<zcode-provider-id>/<modelId>"; the CPAMC
		 * provider's glm-5.3-flash is the only currently working model.
		 */
		models: { zcode: "71fe3b98-87e8-4798-ac98-8985c12de697/th/glm-5.3-flash" },
		steps: {
			design: {
				effort: "high",
				model: "71fe3b98-87e8-4798-ac98-8985c12de697/th/glm-5.3-flash",
			},
			implement: {
				effort: "max",
				model: "71fe3b98-87e8-4798-ac98-8985c12de697/th/glm-5.3-flash",
			},
			integrationReview: {
				effort: "high",
				model: "71fe3b98-87e8-4798-ac98-8985c12de697/th/glm-5.3-flash",
			},
			planner: {
				effort: "high",
				model: "71fe3b98-87e8-4798-ac98-8985c12de697/th/glm-5.3-flash",
			},
			resolve: {
				effort: "max",
				model: "71fe3b98-87e8-4798-ac98-8985c12de697/th/glm-5.3-flash",
			},
			review: {
				effort: "high",
				model: "71fe3b98-87e8-4798-ac98-8985c12de697/th/glm-5.3-flash",
			},
		},
	},
	baseBranch: "main",
	dir: ".sandcastle",
	issueCommand: "gh issue view {issue}",
	labels: { readyForAgent: "ready-for-agent" },
	queue: { commit: true },
	reviewMarker: "Sandcastle-Review",
	setupCommands: ["pnpm setup"],
	skills: {
		labels: {
			ecs: {
				design: ["ecs-design"],
				implement: ["ecs-design"],
			},
			security: {
				design: ["threat-model", "audit-context-building"],
				implement: ["security-scan", "fix-finding", "sharp-edges"],
				review: ["security-diff-scan", "differential-review", "variant-analysis"],
			},
			ui: {
				design: ["react-roblox-ui"],
				implement: ["react-roblox-ui"],
			},
		},
	},
	symlinks: [
		{ path: "creator-docs", target: "creator-docs" },
		{ path: ".sandcastle/plans", target: ".sandcastle/plans" },
		{ path: ".agents", target: ".agents" },
		{ path: ".diracrules", target: ".agents" },
	],
};

export default config;

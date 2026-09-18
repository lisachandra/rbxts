import type { SandcastleUserConfig } from "@lisachandra/sandcastle";

const config: SandcastleUserConfig = {
	agents: {
		default: "dirac",
		enabled: ["dirac", "pi"],
		models: { dirac: "ag/gemini-3.8-flash-high" },
		steps: {
			design: { effort: "xhigh", model: "ag/gemini-3.8-flash-high" },
			implement: { effort: "max", model: "ix/deepseek-v4-flash" },
			integrationReview: { effort: "xhigh", model: "by/muse-spark-1.3-contributor" },
			planner: { effort: "xhigh", model: "ag/gemini-3.8-flash-high" },
			resolve: { effort: "max", model: "ix/deepseek-v4-flash" },
			review: { effort: "xhigh", model: "by/muse-spark-1.3-contributor" },
		},
	},
	baseBranch: "main",
	dir: ".sandcastle",
	issueCommand: "gh issue view {issue}",
	labels: { readyForAgent: "ready-for-agent" },
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

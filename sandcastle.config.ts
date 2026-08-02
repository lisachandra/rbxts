import type { SandcastleConfig } from "@lisachandra/sandcastle";

const config: SandcastleConfig = {
	baseBranch: "main",
	setupCommands: ["git submodule update --init --recursive && pnpm install"],
	symlinks: [
		{ path: "creator-docs", target: "creator-docs" },
		{ path: ".diracrules", target: ".agents" },
	],
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
	labels: { readyForAgent: "ready-for-agent" },
	reviewMarker: "Sandcastle-Review",
	issueCommand: "gh issue view {issue}",
	agents: { enabled: ["dirac", "pi"] },
	effort: "xhigh",
};

export default config;

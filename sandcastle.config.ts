import type { SandcastleConfig } from "@lisachandra/sandcastle";

const config: SandcastleConfig = {
	agents: {
		default: "dirac",
		enabled: ["dirac", "pi"],
		models: {},
	},
	baseBranch: "main",
	dir: ".sandcastle",
	effort: "xhigh",
	issueCommand: "gh issue view {issue}",
	labels: { readyForAgent: "ready-for-agent" },
	prompts: {},
	reviewMarker: "Sandcastle-Review",
	setupCommands: ["git submodule update --init --recursive && pnpm install"],
	skills: {
		defaults: {
			design: ["codebase-design", "domain-modeling", "research", "tdd"],
			implement: ["tdd", "jest", "implement", "roblox-ts"],
			review: ["code-review", "improve-codebase-architecture"],
		},
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
		{ path: ".diracrules", target: ".agents" },
	],
};

export default config;

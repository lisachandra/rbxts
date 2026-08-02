/*
 * Sandcastle configuration.
 *
 * Repos configure the runner through a typed `sandcastle.config.ts` at their
 * repository root. Every field is optional; generic defaults are used for
 * anything a repo does not specify. The file is loaded with jiti and validated
 * with zod so misconfiguration fails fast with a readable error.
 */

import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { z } from "zod";

import type { AgentBackend, PhaseName, SandcastleEffort } from "./types.js";

export type { AgentBackend, PhaseName, SandcastleEffort } from "./types.js";

export type PromptFileKey = "plan" | "implement" | "review" | "planAll" | "resolveConflicts" | "reviewIntegration";

export const phaseNames: ReadonlyArray<PhaseName> = ["design", "implement", "review"];
export const promptFileKeys: ReadonlyArray<PromptFileKey> = [
	"plan",
	"implement",
	"review",
	"planAll",
	"resolveConflicts",
	"reviewIntegration",
];

/** Fully-resolved configuration surface exposed to consumers. */
export interface SandcastleConfig {
	/** Working directory for state, plans, logs, worktrees, and integrations. */
	dir: string;
	/** Branch implementation/review diffs compare against. */
	baseBranch: string;
	/** Shell commands run once in a fresh worktree before phase agents start. */
	setupCommands: Array<string>;
	/** Repository-local directories linked into fresh worktrees. */
	symlinks: Array<{ path: string; target: string }>;
	/** Per-phase prompt files; repo-relative paths resolve from the repo root. */
	prompts: Partial<Record<PromptFileKey, string>>;
	/** Skills routed into phase prompts, per phase and per issue label. */
	skills: {
		defaults: Record<PhaseName, Array<string>>;
		labels: Record<string, Partial<Record<PhaseName, Array<string>>>>;
	};
	labels: {
		/** GitHub issue label that marks an issue as ready for an AFK agent pass. */
		readyForAgent: string;
	};
	/** Machine-readable review marker prefix written as `<marker>: APPROVED|BLOCKED`. */
	reviewMarker: string;
	/** Command template used to view an issue; `{issue}` is replaced with the issue number. */
	issueCommand: string;
	agents: {
		enabled: Array<AgentBackend>;
		/** Backend used when `--agent` is not passed. */
		default: AgentBackend;
		/** Default model per backend, used when `--model` is not passed. */
		models: Partial<Record<AgentBackend, string>>;
	};
	/** Default reasoning effort when the environment does not set SANDCASTLE_EFFORT. */
	effort: SandcastleEffort;
}

/** Config with every prompt path resolved to an absolute file. */
export interface ResolvedSandcastleConfig extends SandcastleConfig {
	prompts: Record<PromptFileKey, string>;
}

const promptFileSchema = z
	.object({
		plan: z.string().optional(),
		implement: z.string().optional(),
		review: z.string().optional(),
		planAll: z.string().optional(),
		resolveConflicts: z.string().optional(),
		reviewIntegration: z.string().optional(),
	})
	.optional();

export const sandcastleConfigSchema = z
	.object({
		dir: z.string().optional(),
		baseBranch: z.string().optional(),
		setupCommands: z.array(z.string()).optional(),
		symlinks: z
			.array(
				z.object({
					/** Path inside the worktree (e.g. "creator-docs"). */
					path: z.string(),
					/** Path in the repository root (e.g. "creator-docs"). */
					target: z.string(),
				}),
			)
			.optional(),
		prompts: promptFileSchema,
		skills: z
			.object({
				defaults: z
					.object({
						design: z.array(z.string()).optional(),
						implement: z.array(z.string()).optional(),
						review: z.array(z.string()).optional(),
					})
					.optional(),
				labels: z
					.record(
						z.string(),
						z.object({
							design: z.array(z.string()).optional(),
							implement: z.array(z.string()).optional(),
							review: z.array(z.string()).optional(),
						}),
					)
					.optional(),
			})
			.optional(),
		labels: z
			.object({
				readyForAgent: z.string().optional(),
			})
			.optional(),
		reviewMarker: z.string().optional(),
		issueCommand: z.string().optional(),
		agents: z
			.object({
				enabled: z.array(z.enum(["dirac", "pi"])).optional(),
				default: z.enum(["dirac", "pi"]).optional(),
				models: z
					.object({
						dirac: z.string().optional(),
						pi: z.string().optional(),
					})
					.optional(),
			})
			.optional(),
		effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
	})
	.strict();

/**
 * Partial config accepted in `sandcastle.config.ts`; every field is optional.
 * Use this in consumer config files — `SandcastleConfig` is the fully-resolved
 * shape produced by `loadConfig`.
 */
export type SandcastleUserConfig = z.input<typeof sandcastleConfigSchema>;

const defaultConfig: SandcastleConfig = {
	dir: ".sandcastle",
	baseBranch: "main",
	setupCommands: [],
	symlinks: [],
	prompts: {},
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
	labels: {
		readyForAgent: "ready-for-agent",
	},
	reviewMarker: "Sandcastle-Review",
	issueCommand: "gh issue view {issue}",
	agents: {
		enabled: ["dirac", "pi"],
		default: "dirac",
		models: {},
	},
	effort: "xhigh",
};

/**
 * Loads `<repoRoot>/sandcastle.config.ts` (if present) and merges it over the
 * package defaults. Never throws for a missing file; throws with a readable
 * message when a present config fails validation.
 */
export function loadConfig(repoRoot: string): ResolvedSandcastleConfig {
	const packageRoot = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");
	const configPath = pathResolve(repoRoot, "sandcastle.config.ts");

	let userConfig: unknown = {};
	if (existsSync(configPath)) {
		try {
			const jiti = createJiti(import.meta.url, { interopDefault: true });
			const loaded = jiti(configPath) as unknown;
			userConfig =
				loaded !== null && typeof loaded === "object" && "default" in loaded
					? (loaded as { default: unknown }).default
					: loaded;
		} catch (err) {
			throw new Error(`Could not load ${configPath}: ${String(err)}`);
		}
	}

	const parsed = sandcastleConfigSchema.parse(userConfig);
	const merged: SandcastleConfig = {
		dir: parsed.dir ?? defaultConfig.dir,
		baseBranch: parsed.baseBranch ?? defaultConfig.baseBranch,
		setupCommands: parsed.setupCommands ?? defaultConfig.setupCommands,
		symlinks: parsed.symlinks ?? defaultConfig.symlinks,
		prompts: parsed.prompts ?? {},
		skills: {
			defaults: {
				design: parsed.skills?.defaults?.design ?? defaultConfig.skills.defaults.design,
				implement:
					parsed.skills?.defaults?.implement ?? defaultConfig.skills.defaults.implement,
				review: parsed.skills?.defaults?.review ?? defaultConfig.skills.defaults.review,
			},
			labels: { ...defaultConfig.skills.labels, ...(parsed.skills?.labels ?? {}) },
		},
		labels: {
			readyForAgent:
				parsed.labels?.readyForAgent ?? defaultConfig.labels.readyForAgent,
		},
		reviewMarker: parsed.reviewMarker ?? defaultConfig.reviewMarker,
		issueCommand: parsed.issueCommand ?? defaultConfig.issueCommand,
		agents: {
			enabled: parsed.agents?.enabled ?? defaultConfig.agents.enabled,
			default: parsed.agents?.default ?? defaultConfig.agents.default,
			models: {
				...(parsed.agents?.models?.dirac !== undefined
					? { dirac: parsed.agents.models.dirac }
					: {}),
				...(parsed.agents?.models?.pi !== undefined ? { pi: parsed.agents.models.pi } : {}),
			},
		},
		effort: parsed.effort ?? defaultConfig.effort,
	};

	const promptDefaults: Record<PromptFileKey, string> = {
		plan: pathResolve(packageRoot, "prompts", "plan-prompt.md"),
		implement: pathResolve(packageRoot, "prompts", "implement-issue.md"),
		review: pathResolve(packageRoot, "prompts", "review-issue.md"),
		planAll: pathResolve(packageRoot, "prompts", "plan-all.md"),
		resolveConflicts: pathResolve(packageRoot, "prompts", "resolve-conflicts.md"),
		reviewIntegration: pathResolve(packageRoot, "prompts", "review-integration.md"),
	};

	const prompts: Record<PromptFileKey, string> = { ...promptDefaults };
	for (const key of promptFileKeys) {
		const value = merged.prompts[key];
		if (value !== undefined && value !== "") {
			prompts[key] = pathResolve(repoRoot, value);
		}
	}

	return { ...merged, prompts };
}

/** Escapes a literal string for use inside a RegExp. */
export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

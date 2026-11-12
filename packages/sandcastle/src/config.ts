/*
 * Sandcastle configuration.
 *
 * Repos configure the runner through a typed `sandcastle.config.ts` at their
 * repository root. Every field is optional; generic defaults are used for
 * anything a repo does not specify. The file is loaded with jiti and validated
 * with zod so misconfiguration fails fast with a readable error.
 */

import { createJiti } from "jiti";
import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import type { AgentBackend, AgentStepsConfig, PhaseName, SandcastleEffort } from "./types.js";

export type {
	AgentBackend,
	AgentPhaseName,
	AgentStepConfig,
	AgentStepsConfig,
	PhaseName,
	ResolvedAgentStep,
	SandcastleEffort,
} from "./types.js";

export type PromptFileKey =
	| "plan"
	| "review"
	| "planAll"
	| "implement"
	| "resolveConflicts"
	| "reviewIntegration";

const agentBackendSchema = z.enum([
	"claude-code",
	"codex",
	"copilot",
	"cursor",
	"dirac",
	"opencode",
	"pi",
	"zcode",
]);

/**
 * Where `setupCommands` output goes.
 *
 * `log` redirects stdout and stderr into a file under the logs directory; `inherit` streams them
 * into the runner's own stdout/stderr, the pre-logging behavior.
 */
export const setupOutputs = ["inherit", "log"] as const;

export type SetupOutput = (typeof setupOutputs)[number];

/** Cross-machine dispatch guard modes; see `SandcastleConfig.queue.lease`. */
export const queueLeases = ["auto", "off", "strict"] as const;

export type QueueLeaseMode = (typeof queueLeases)[number];

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
	agents: {
		/**
		 * Selectable model + harness profiles for `queue run --parallel`.
		 *
		 * Empty means the repository has not opted in: dispatch uses the single workflow default
		 * and refuses `--parallel` above one.
		 */
		catalog: Array<AgentProfile>;
		/** Backend used when `--agent` is not passed. */
		default: AgentBackend;
		enabled: Array<AgentBackend>;
		/** Default model per backend, used when `--model` is not passed. */
		models: Partial<Record<AgentBackend, string>>;
		/** Per-step agent/model/effort overrides; missing steps inherit workflow defaults. */
		steps: AgentStepsConfig;
	};
	/** Branch implementation/review diffs compare against. */
	baseBranch: string;
	/** Working directory for state, plans, logs, worktrees, and integrations. */
	dir: string;
	/** Default reasoning effort when the environment does not set SANDCASTLE_EFFORT. */
	effort: SandcastleEffort;
	/** Integration composition: how the merge that commits an integration branch is made. */
	integration: {
		/**
		 * Merge-commit subject; `{source}` is replaced with the source name. Conventional by
		 * default: a repository with commitlint rejects a subject that carries no type, which would
		 * leave the merge uncommitted and read as a conflict.
		 */
		mergeSubject: string;
		/**
		 * Run the repository's git hooks for that merge commit. Off by default: the hooks target
		 * human commits, and a rejected one leaves the composition half-finished.
		 */
		verifyHooks: boolean;
	};
	/** Command template used to view an issue; `{issue}` is replaced with the issue number. */
	issueCommand: string;
	labels: {
		/** GitHub issue label that marks an issue as ready for an AFK agent pass. */
		readyForAgent: string;
	};
	/** Per-phase prompt files; repo-relative paths resolve from the repo root. */
	prompts: Partial<Record<PromptFileKey, string>>;
	/** Queue manifest configuration; the manifest stores what GitHub cannot express. */
	queue: {
		/** Commit the manifest after every successful mutation (never pushes). */
		commit: boolean;
		/**
		 * Branch the primary checkout must be on for that commit; defaults to `baseBranch`. A
		 * checkout on any other branch is reported and skipped, so a registration never lands on
		 * unrelated work.
		 */
		commitBranch: string;
		/** When false, the queue workflow is bypassed: no gating, no prompt contract. */
		enabled: boolean;
		file: string;
		/**
		 * Cross-machine dispatch guard.
		 *
		 * `auto` takes a lease on `origin` when it can and falls back to a local-only run when it
		 * cannot; `strict` refuses to dispatch without one; `off` makes no network calls at all.
		 * The lease is what stops two checkouts from reserving the same batch — the locks in
		 * `.sandcastle` only ever guard one machine.
		 */
		lease: QueueLeaseMode;
		/**
		 * How many batches `queue run` may execute at once.
		 *
		 * This is the repository's allowance, not a per-run default: `--parallel <n>` may lower it
		 * but never exceed it, so the machine and API budget stay the owner's decision. Members
		 * inside one batch are never parallel — each member's branch is the next member's base.
		 */
		parallel: number;
		/**
		 * When true, dispatch aborts instead of warning when a reused member's branch does not
		 * contain the accumulated base — the signature of a member inserted ahead of already-run
		 * members and never picked up.
		 */
		strictChain: boolean;
	};
	/** Machine-readable review marker prefix written as `<marker>: APPROVED|BLOCKED`. */
	reviewMarker: string;
	/** Shell commands run once in a fresh worktree before phase agents start. */
	setupCommands: Array<string>;
	/**
	 * Where `setupCommands` output goes when the command does not pass `--setup-output`.
	 *
	 * Left `undefined` when the repository does not configure it so the command default survives:
	 * agent runs log, a standalone `sandcastle setup` inherits.
	 */
	setupOutput?: SetupOutput;
	/** Skills routed into phase prompts, per phase and per issue label. */
	skills: {
		defaults: Record<PhaseName, Array<string>>;
		labels: Record<string, Partial<Record<PhaseName, Array<string>>>>;
	};
	/** Repository-local directories linked into fresh worktrees. */
	symlinks: Array<{ path: string; target: string }>;
}

/** Config with every prompt path resolved to an absolute file. */
export interface ResolvedSandcastleConfig extends SandcastleConfig {
	prompts: Record<PromptFileKey, string>;
}

const promptFileSchema = z
	.object({
		implement: z.string().optional(),
		plan: z.string().optional(),
		planAll: z.string().optional(),
		resolveConflicts: z.string().optional(),
		review: z.string().optional(),
		reviewIntegration: z.string().optional(),
	})
	.optional();

const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

const agentStepSchema = z
	.object({
		backend: agentBackendSchema.optional(),
		effort: effortSchema.optional(),
		model: z.string().min(1).optional(),
	})
	.strict();

const agentStepsSchema = z
	.object({
		design: agentStepSchema.optional(),
		implement: agentStepSchema.optional(),
		integrationReview: agentStepSchema.optional(),
		planner: agentStepSchema.optional(),
		resolve: agentStepSchema.optional(),
		review: agentStepSchema.optional(),
	})
	.strict()
	.optional();

/**
 * One selectable model + harness profile.
 *
 * A profile is a named `backend`/`model`/`effort` triple with optional per-step overrides, so a
 * repository can say "the cheap lane" and "the deep lane" once instead of restating a model for
 * every batch it defines. `queue run --parallel` assigns one profile per lane; a serial run uses
 * the first.
 */
const agentProfileSchema = z
	.object({
		backend: agentBackendSchema,
		/** Default reasoning effort for this profile; falls back to the workflow effort. */
		effort: effortSchema.optional(),
		model: z.string().min(1),
		/** Stable id used in logs and lane assignment, e.g. "flash". */
		name: z.string().min(1),
		/** Per-step overrides inside this profile, e.g. a cheaper review. */
		steps: agentStepsSchema,
	})
	.strict();

export type AgentProfile = z.output<typeof agentProfileSchema>;

export const sandcastleConfigSchema = z
	.object({
		agents: z
			.object({
				catalog: z.array(agentProfileSchema).optional(),
				default: agentBackendSchema.optional(),
				enabled: z.array(agentBackendSchema).optional(),
				models: z
					.object({
						"claude-code": z.string().optional(),
						"codex": z.string().optional(),
						"copilot": z.string().optional(),
						"cursor": z.string().optional(),
						"dirac": z.string().optional(),
						"opencode": z.string().optional(),
						"pi": z.string().optional(),
						"zcode": z.string().optional(),
					})
					.optional(),
				steps: agentStepsSchema,
			})
			.optional(),
		baseBranch: z.string().optional(),
		dir: z.string().optional(),
		effort: effortSchema.optional(),
		integration: z
			.object({
				mergeSubject: z.string().min(1).optional(),
				verifyHooks: z.boolean().optional(),
			})
			.optional(),
		issueCommand: z.string().optional(),
		labels: z
			.object({
				readyForAgent: z.string().optional(),
			})
			.optional(),
		prompts: promptFileSchema,
		queue: z
			.object({
				commit: z.boolean().optional(),
				commitBranch: z.string().min(1).optional(),
				enabled: z.boolean().optional(),
				file: z.string().min(1).optional(),
				lease: z.enum(queueLeases).optional(),
				parallel: z.number().int().min(1).optional(),
				strictChain: z.boolean().optional(),
			})
			.optional(),
		reviewMarker: z.string().optional(),
		setupCommands: z.array(z.string()).optional(),
		setupOutput: z.enum(setupOutputs).optional(),
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
	})
	.strict();

/**
 * Partial config accepted in `sandcastle.config.ts`; every field is optional. Use this in consumer
 * config files — `SandcastleConfig` is the fully-resolved shape produced by `loadConfig`.
 */
export type SandcastleUserConfig = z.input<typeof sandcastleConfigSchema>;

const defaultConfig: SandcastleConfig = {
	agents: {
		catalog: [],
		default: "dirac",
		enabled: ["claude-code", "codex", "copilot", "cursor", "dirac", "opencode", "pi", "zcode"],
		models: {},
		steps: {},
	},
	baseBranch: "main",
	dir: ".sandcastle",
	effort: "xhigh",
	integration: {
		mergeSubject: "chore(integration): integrate {source}",
		verifyHooks: false,
	},
	issueCommand: "gh issue view {issue}",
	labels: {
		readyForAgent: "ready-for-agent",
	},
	prompts: {},
	queue: {
		commit: false,
		commitBranch: "main",
		enabled: true,
		file: "sandcastle.queue.json",
		lease: "auto",
		parallel: 1,
		strictChain: false,
	},
	reviewMarker: "Sandcastle-Review",
	setupCommands: [],
	skills: {
		defaults: {
			design: ["codebase-design", "domain-modeling", "research", "tdd"],
			implement: ["tdd", "jest", "implement", "roblox-ts"],
			review: ["sandcastle", "code-review", "improve-codebase-architecture"],
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
	symlinks: [],
};

/**
 * Loads `<repoRoot>/sandcastle.config.ts` (if present) and merges it over the package defaults.
 * Never throws for a missing file; throws with a readable message when a present config fails
 * validation.
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
					? loaded.default
					: loaded;
		} catch (err) {
			throw new Error(`Could not load ${configPath}: ${String(err)}`);
		}
	}

	const parsed = sandcastleConfigSchema.parse(userConfig);
	const merged: SandcastleConfig = {
		agents: {
			catalog: parsed.agents?.catalog ?? defaultConfig.agents.catalog,
			default: parsed.agents?.default ?? defaultConfig.agents.default,
			enabled: parsed.agents?.enabled ?? defaultConfig.agents.enabled,
			models: {
				...(parsed.agents?.models?.["claude-code"] !== undefined
					? { "claude-code": parsed.agents.models["claude-code"] }
					: {}),
				...(parsed.agents?.models?.codex !== undefined
					? { codex: parsed.agents.models.codex }
					: {}),
				...(parsed.agents?.models?.copilot !== undefined
					? { copilot: parsed.agents.models.copilot }
					: {}),
				...(parsed.agents?.models?.cursor !== undefined
					? { cursor: parsed.agents.models.cursor }
					: {}),
				...(parsed.agents?.models?.dirac !== undefined
					? { dirac: parsed.agents.models.dirac }
					: {}),
				...(parsed.agents?.models?.opencode !== undefined
					? { opencode: parsed.agents.models.opencode }
					: {}),
				...(parsed.agents?.models?.pi !== undefined ? { pi: parsed.agents.models.pi } : {}),
				...(parsed.agents?.models?.zcode !== undefined
					? { zcode: parsed.agents.models.zcode }
					: {}),
			},
			steps: parsed.agents?.steps ?? {},
		},
		baseBranch: parsed.baseBranch ?? defaultConfig.baseBranch,
		dir: parsed.dir ?? defaultConfig.dir,
		effort: parsed.effort ?? defaultConfig.effort,
		integration: {
			mergeSubject:
				parsed.integration?.mergeSubject ?? defaultConfig.integration.mergeSubject,
			verifyHooks: parsed.integration?.verifyHooks ?? defaultConfig.integration.verifyHooks,
		},
		issueCommand: parsed.issueCommand ?? defaultConfig.issueCommand,
		labels: {
			readyForAgent: parsed.labels?.readyForAgent ?? defaultConfig.labels.readyForAgent,
		},
		prompts: parsed.prompts ?? {},
		queue: {
			commit: parsed.queue?.commit ?? defaultConfig.queue.commit,
			commitBranch:
				parsed.queue?.commitBranch ?? parsed.baseBranch ?? defaultConfig.queue.commitBranch,
			enabled: parsed.queue?.enabled ?? defaultConfig.queue.enabled,
			file: parsed.queue?.file ?? defaultConfig.queue.file,
			lease: parsed.queue?.lease ?? defaultConfig.queue.lease,
			parallel: parsed.queue?.parallel ?? defaultConfig.queue.parallel,
			strictChain: parsed.queue?.strictChain ?? defaultConfig.queue.strictChain,
		},
		reviewMarker: parsed.reviewMarker ?? defaultConfig.reviewMarker,
		setupCommands: parsed.setupCommands ?? defaultConfig.setupCommands,
		/*
		 * Deliberately not defaulted: `undefined` means "no repository preference", which each
		 * command resolves against its own default (agent paths log, standalone setup inherits).
		 */
		...(parsed.setupOutput !== undefined ? { setupOutput: parsed.setupOutput } : {}),
		skills: {
			defaults: {
				design: parsed.skills?.defaults?.design ?? defaultConfig.skills.defaults.design,
				implement:
					parsed.skills?.defaults?.implement ?? defaultConfig.skills.defaults.implement,
				review: parsed.skills?.defaults?.review ?? defaultConfig.skills.defaults.review,
			},
			labels: { ...defaultConfig.skills.labels, ...(parsed.skills?.labels ?? {}) },
		},
		symlinks: parsed.symlinks ?? defaultConfig.symlinks,
	};

	const promptDefaults: Record<PromptFileKey, string> = {
		implement: pathResolve(packageRoot, "prompts", "implement-issue.md"),
		plan: pathResolve(packageRoot, "prompts", "plan-prompt.md"),
		planAll: pathResolve(packageRoot, "prompts", "plan-all.md"),
		resolveConflicts: pathResolve(packageRoot, "prompts", "resolve-conflicts.md"),
		review: pathResolve(packageRoot, "prompts", "review-issue.md"),
		reviewIntegration: pathResolve(packageRoot, "prompts", "review-integration.md"),
	};

	const prompts: Record<PromptFileKey, string> = { ...promptDefaults };
	for (const key of promptFileKeys) {
		const value = merged.prompts[key];
		if (value !== undefined && value !== "") {
			prompts[key] = pathResolve(repoRoot, value);
		}
	}

	validateCatalog(configPath, merged.agents);

	return { ...merged, prompts };
}

/**
 * - Rejects a catalog a lane could not run.
 * - @param configPath - The file being validated, so the message names what to edit.
 * - @param agents - Resolved agents block: catalog, enabled backends, and per-backend models.
 * - @throws {Error} When a profile name repeats, a profile names a backend the repository disabled,
 *   or a profile supplies no model and no `agents.models` entry covers its backend.
 * - @remarks The catalog is checked at load time rather than at lane spawn: a typo in a lane's model
 *   should fail the run before any worktree is built, not halfway through a batch.
 */
function validateCatalog(configPath: string, agents: SandcastleConfig["agents"]): void {
	const seen = new Set<string>();
	for (const profile of agents.catalog) {
		if (seen.has(profile.name)) {
			throw new Error(
				`${configPath}: agents.catalog repeats the profile name "${profile.name}"; profile names identify lanes, so they must be unique.`,
			);
		}

		seen.add(profile.name);

		if (!agents.enabled.includes(profile.backend)) {
			throw new Error(
				`${configPath}: agents.catalog profile "${profile.name}" uses backend "${profile.backend}", which agents.enabled does not list. Add it to agents.enabled or change the profile's backend.`,
			);
		}

		/*
		 * `model` is required by the schema, so this only catches a profile that relied on whitespace;
		 * the check stays because the failure it prevents surfaces mid-batch otherwise.
		 */
		if (profile.model.trim() === "") {
			throw new Error(
				`${configPath}: agents.catalog profile "${profile.name}" has an empty model.`,
			);
		}
	}
}

/** Escapes a literal string for use inside a RegExp. */
export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

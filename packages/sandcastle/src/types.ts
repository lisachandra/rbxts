/*
 * Shared Sandcastle types.
 *
 * These are the small vocabulary types used across the runner. Module-local
 * types that only one file needs stay in that file; anything imported by two
 * or more modules lives here.
 */

export type PhaseName = "design" | "review" | "implement";
/** Every agent-driven step, including issue phases, planner, and integration steps. */
export type AgentPhaseName = PhaseName | "planner" | "resolve" | "integrationReview";
export type AgentBackend =
	| "pi"
	| "codex"
	| "dirac"
	| "cursor"
	| "copilot"
	| "opencode"
	| "claude-code";
/**
 * Backend effort levels. "max" is natively supported by dirac and claude-code and is forwarded
 * untouched; backends capped at "xhigh" (pi, codex) map it down via `resolveBackendEffort`.
 */
export type SandcastleEffort = "low" | "max" | "high" | "xhigh" | "medium";

/** Per-step agent/model/effort override. Every field falls back to the workflow default. */
export interface AgentStepConfig {
	backend?: AgentBackend;
	effort?: SandcastleEffort;
	model?: string;
}

/** Resolved agent/model/effort triple handed to `createAgent`. */
export interface ResolvedAgentStep {
	agentBackend: AgentBackend;
	effort: SandcastleEffort;
	model: string;
}

/** Agent/model/effort per agent-driven step. Missing steps inherit the workflow default. */
export type AgentStepsConfig = Partial<Record<AgentPhaseName, AgentStepConfig>>;
export type PhaseStatus = "done" | "failed" | "skipped";
export type PhaseDecision = "skip" | "start" | "force";

export type IntegrationKind = "issues" | "integrations";
export type IntegrationStatus =
	| "created"
	| "merging"
	| "aborted"
	| "blocked"
	| "reviewing"
	| "integrated"
	| "review-passed"
	| "review-failed"
	| "preflight-failed"
	| "ready-for-human-merge"
	| "conflict-resolution-required";

export interface IntegrationSource {
	branch: string;
	commit: string;
	issue?: string;
	name: string;
	order: number;
}

/** Uncommitted worktree changes set aside before an integration merge. */
export interface IntegrationDrift {
	/** Tracked paths the quarantine stash removed from the working tree. */
	paths: Array<string>;
	/** Stash commit; restore with `git stash apply <commit>`. */
	stashCommit?: string;
	stashedAt: string;
}

export interface IntegrationManifest {
	allowUnreviewed?: boolean;
	base: { commit: string; ref: string };
	branch: string;
	createdAt: string;
	currentSource?: number;
	/** Set when `--quarantine-drift` stashed uncommitted changes before merging. */
	drift?: IntegrationDrift;
	headCommit?: string;
	kind: IntegrationKind;
	lastError?: string;
	name: string;
	sources: Array<IntegrationSource>;
	status: IntegrationStatus;
	updatedAt: string;
	worktree: string;
}

export interface PhaseRecord {
	/**
	 * Design: path to plan file. Implement: list of commit SHAs. Review: whether comment was
	 * posted.
	 */
	extra?: Record<string, unknown>;
	status: PhaseStatus;
	timestamp: string;
}

export interface PhaseState {
	base?: { commit: string; ref: string };
	branch: string;
	effort: string;
	issue: string;
	lastError?: string;
	model: string;
	phases: Record<PhaseName, PhaseRecord>;
	/** Resolved per-phase agent/model/effort used by the last run; absent on legacy states. */
	phasesConfig?: Partial<Record<PhaseName, ResolvedAgentStep>>;
}

/** Variables substituted into the phase prompt files. */
export interface SharedPromptArgs {
	[key: string]: string | undefined;
	BASE_REF?: string;
	BRANCH?: string;
	ISSUE_NUMBER?: string;
	ISSUE_TITLE?: string;
	MARKER_DIR?: string;
	MARKER_PATH?: string;
	PLAN_PATH?: string;
	READY_LABEL?: string;
	SKILLS: string;
}

export interface EvaluationResult {
	design: PhaseDecision;
	implement: PhaseDecision;
	reasons: Record<PhaseName, string>;
	review: PhaseDecision;
}

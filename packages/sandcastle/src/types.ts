/*
 * Shared Sandcastle types.
 *
 * These are the small vocabulary types used across the runner. Module-local
 * types that only one file needs stay in that file; anything imported by two
 * or more modules lives here.
 */

export type PhaseName = "design" | "review" | "implement";
export type AgentBackend =
	| "pi"
	| "codex"
	| "dirac"
	| "cursor"
	| "copilot"
	| "opencode"
	| "claude-code";
/**
 * Backend effort levels. "max" is accepted as a user-facing alias and maps to "xhigh" (the highest
 * level the dirac/pi CLIs support).
 */
export type SandcastleEffort = "low" | "max" | "high" | "xhigh" | "medium";
export type PhaseStatus = "done" | "failed" | "skipped";
export type PhaseDecision = "skip" | "start" | "force";

export type IntegrationKind = "issues" | "integrations";
export type IntegrationStatus =
	| "created"
	| "merging"
	| "aborted"
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

export interface IntegrationManifest {
	allowUnreviewed?: boolean;
	base: { commit: string; ref: string };
	branch: string;
	createdAt: string;
	currentSource?: number;
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

/*
 * Per-step agent/model/effort resolution.
 *
 * Every agent-driven step (design/implement/review/planner/resolve/integrationReview)
 * inherits the workflow default unless overridden in `agents.steps` config or via
 * per-step CLI flags. Precedence: CLI flag > agents.steps config > workflow default.
 */

import type {
	AgentBackend,
	AgentPhaseName,
	AgentStepConfig,
	AgentStepsConfig,
	ResolvedAgentStep,
} from "./types.js";

export const agentStepNames: ReadonlyArray<AgentPhaseName> = [
	"design",
	"implement",
	"review",
	"planner",
	"resolve",
	"integrationReview",
];

export interface WorkflowDefaults {
	agentBackend: AgentBackend;
	effort: WorkflowDefaultsEffort;
	model: string;
}

type WorkflowDefaultsEffort = ResolvedAgentStep["effort"];

function legacyModelFor(backend: AgentBackend): string {
	if (backend === "dirac") {
		return process.env.DIRAC_SANDCASTLE_MODEL?.trim() ?? "";
	}

	if (backend === "pi") {
		return process.env.PI_SANDCASTLE_MODEL?.trim() ?? "";
	}

	return "";
}

/**
 * Resolves one step. When the step selects a different backend than the workflow and neither CLI
 * nor config supplies a model, the mapped model for that backend (`agents.models[backend]`, then
 * legacy env) wins over the workflow model.
 */
export function resolveAgentStep(
	configStep: AgentStepConfig | undefined,
	cliStep: AgentStepConfig | undefined,
	workflow: WorkflowDefaults,
	models: Partial<Record<AgentBackend, string>>,
): ResolvedAgentStep {
	const agentBackend = cliStep?.backend ?? configStep?.backend ?? workflow.agentBackend;
	const effort = cliStep?.effort ?? configStep?.effort ?? workflow.effort;
	const cliModel = cliStep?.model?.trim() ?? "";
	const configModel = configStep?.model?.trim() ?? "";
	let model: string;
	if (cliModel !== "") {
		model = cliModel;
	} else if (configModel !== "") {
		model = configModel;
	} else if (agentBackend !== workflow.agentBackend) {
		model =
			models[agentBackend]?.trim() !== undefined && models[agentBackend]?.trim() !== ""
				? (models[agentBackend]?.trim() as string)
				: legacyModelFor(agentBackend) !== ""
					? legacyModelFor(agentBackend)
					: workflow.model;
	} else {
		model = workflow.model;
	}

	return { agentBackend, effort, model };
}

/** Resolves every agent-driven step from workflow defaults + config steps + CLI overrides. */
export function resolveAgentSteps(
	workflow: WorkflowDefaults,
	models: Partial<Record<AgentBackend, string>>,
	configSteps: AgentStepsConfig = {},
	cliSteps: AgentStepsConfig = {},
): Record<AgentPhaseName, ResolvedAgentStep> {
	const resolved = {} as Record<AgentPhaseName, ResolvedAgentStep>;
	for (const step of agentStepNames) {
		resolved[step] = resolveAgentStep(configSteps[step], cliSteps[step], workflow, models);
	}

	return resolved;
}

/** Narrows a full step map to the three issue phases for `PhaseState.phasesConfig`. */
export function phaseSteps(
	steps: Partial<Record<AgentPhaseName, ResolvedAgentStep>>,
	fallback: WorkflowDefaults,
): Record<"design" | "implement" | "review", ResolvedAgentStep> {
	const pick = (name: "design" | "implement" | "review"): ResolvedAgentStep =>
		steps[name] ?? {
			agentBackend: fallback.agentBackend,
			effort: fallback.effort,
			model: fallback.model,
		};
	return { design: pick("design"), implement: pick("implement"), review: pick("review") };
}

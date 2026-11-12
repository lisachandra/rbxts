/*
 * Lane profiles: which model + harness a `queue run` lane executes with.
 *
 * A repository declares its selectable profiles once, in `agents.catalog`. A serial run and lane 0 of
 * a parallel run both use the first profile, so the two paths cannot disagree about which model a
 * batch ran on; every later lane takes the next profile in order, wrapping.
 *
 * Profile resolution is an overlay, not a second resolver: it feeds {@link resolveAgentSteps} a
 * different workflow default and merges the profile's per-step overrides over `agents.steps`. CLI
 * per-step flags still win, because that is the caller's last word about the work in front of them.
 */

import type { AgentProfile, SandcastleConfig } from "../config.js";
import { resolveAgentSteps } from "../steps.js";
import type {
	AgentBackend,
	AgentPhaseName,
	AgentStepsConfig,
	ResolvedAgentStep,
} from "../types.js";

/** The agent/model/effort surface a lane overlays onto a run's options. */
export interface LaneAgentConfig {
	agentBackend: AgentBackend;
	effort: ResolvedAgentStep["effort"];
	model: string;
	steps: Record<AgentPhaseName, ResolvedAgentStep>;
}

/** Profiles in lane order; an empty catalog means the repository never opted in. */
export function laneProfiles(config: SandcastleConfig): Array<AgentProfile> {
	return config.agents.catalog;
}

/**
 * - The profile lane `index` runs.
 * - @param catalog - `agents.catalog`, in declared order.
 * - @param index - Zero-based lane index.
 * - @returns The profile, or `undefined` when the catalog is empty or the name is unknown.
 * - @remarks Wrapping (`index % length`) rather than refusing: three ready batches and a two-profile
 *   catalog is a normal queue, and a lane is a slot rather than an identity. Which profile a given
 *   index drew is printed up front, so a wrapped assignment is visible instead of inferred.
 */
export function profileForLane(
	catalog: ReadonlyArray<AgentProfile>,
	index: number,
): undefined | AgentProfile {
	if (catalog.length === 0) {
		return undefined;
	}

	return catalog[index % catalog.length];
}

/** The profile `--profile <name>` selects, or `undefined` when no flag was passed or it is unknown. */
export function profileByName(
	catalog: ReadonlyArray<AgentProfile>,
	name: string | undefined,
): undefined | AgentProfile {
	if (name === undefined || name === "") {
		return undefined;
	}

	return catalog.find((profile) => profile.name === name);
}

/** Merges a profile's per-step overrides over the repository's steps; the profile wins. */
function mergeSteps(base: AgentStepsConfig, overlay: AgentStepsConfig): AgentStepsConfig {
	const merged: AgentStepsConfig = { ...base };
	for (const step of Object.keys(overlay) as Array<AgentPhaseName>) {
		const override = overlay[step];
		if (override === undefined) {
			continue;
		}

		merged[step] = { ...base[step], ...override };
	}

	return merged;
}

/**
 * - Resolves every agent step for one lane's profile.
 * - @param config - Loaded configuration: catalog-independent models, steps, and effort.
 * - @param profile - The profile this lane runs.
 * - @param cliSteps - Per-step CLI overrides, which win over both the profile and the config.
 * - @returns The workflow defaults plus the resolved per-step map for that lane.
 * - @remarks The profile replaces the workflow default (backend/model/effort) rather than overriding
 *   it per field, so a profile is self-contained: "flash" means flash for every step that does not
 *   name its own override, and it cannot inherit half of an unrelated `--model`.
 */
export function resolveLaneAgents(
	config: SandcastleConfig,
	profile: AgentProfile,
	cliSteps: AgentStepsConfig = {},
): LaneAgentConfig {
	const steps = resolveAgentSteps(
		{
			agentBackend: profile.backend,
			effort: profile.effort ?? config.effort,
			model: profile.model,
		},
		config.agents.models,
		mergeSteps(config.agents.steps, profile.steps ?? {}),
		cliSteps,
	);

	/*
	 * The lane's workflow default is the profile, not whatever the resolved design step became: a
	 * profile that only overrode `review` still names the model its own unlisted steps run, and
	 * deriving it from the map would let a config-level `design` override masquerade as the profile.
	 */
	return {
		agentBackend: profile.backend,
		effort: profile.effort ?? config.effort,
		model: profile.model,
		steps,
	};
}

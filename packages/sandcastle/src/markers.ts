/*
 * Phase-scoped completion markers.
 *
 * Agents signal completion by creating a marker file as their final action.
 * Markers are scoped per run (issue phase, planner, integration step) and are
 * cleared before every run so stale files can never complete a later phase.
 */

import type { SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import { createAgent } from "./agent.js";
import { completionRules } from "./prompts/completion.js";
import { config, stateRoot } from "./runtime.js";
import type { AgentBackend } from "./types.js";

export function markersDir(): string {
	return pathResolve(stateRoot, config.dir, "markers");
}

/** Absolute host path for a scoped completion marker, e.g. `<scope>.completed`. */
export function markerPath(scope: string): string {
	return pathResolve(markersDir(), `${scope}.completed`);
}

/** Create the markers directory and delete any stale marker at `path`. */
export function clearMarker(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	rmSync(path, { force: true });
}

export function markerExists(path: string): boolean {
	return existsSync(path);
}

/**
 * Prompt arguments a marker-backed phase needs: the completion block, marker path baked in.
 *
 * The path is interpolated here rather than left as a placeholder, so a nested substitution is
 * never what the agent ends up reading.
 */
export function completionPromptArgs(path: string): { COMPLETION: string } {
	return { COMPLETION: completionRules(path) };
}

/**
 * Runs one marker-backed agent phase: clears the scoped marker, builds the agent, runs a single
 * iteration, and fails the phase if the marker is missing.
 *
 * @rejects {Error} When the phase finishes without a completion marker.
 */
export async function runMarkerPhase(params: {
	agentBackend: AgentBackend;
	effort: string;
	marker: string;
	model: string;
	name: string;
	promptArgs: NonNullable<SandboxRunOptions["promptArgs"]>;
	promptFile: string;
	run: (options: SandboxRunOptions) => Promise<SandboxRunResult>;
	runOptions?: Omit<
		SandboxRunOptions,
		"name" | "agent" | "promptArgs" | "promptFile" | "maxIterations"
	>;
}): Promise<SandboxRunResult> {
	clearMarker(params.marker);
	const agent = createAgent(params.agentBackend, params.model, params.effort, params.marker);
	const result = await params.run({
		...params.runOptions,
		agent,
		maxIterations: 1,
		name: params.name,
		promptArgs: { ...params.promptArgs, ...completionPromptArgs(params.marker) },
		promptFile: params.promptFile,
	});

	if (!markerExists(params.marker)) {
		throw new Error(`${params.name} finished without a completion marker.`);
	}

	return result;
}

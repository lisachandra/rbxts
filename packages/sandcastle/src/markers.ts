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
import { config, repoRoot } from "./runtime.js";
import type { AgentBackend } from "./types.js";

export function markersDir(): string {
	return pathResolve(repoRoot, config.dir, "markers");
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

/** POSIX-style paths for prompt substitution; agents run under bash. */
export function markerPromptArgs(path: string): {
	MARKER_DIR: string;
	MARKER_PATH: string;
} {
	const posix = (value: string): string => value.replaceAll("\\", "/");
	return {
		MARKER_DIR: posix(dirname(path)),
		MARKER_PATH: posix(path),
	};
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
		promptArgs: { ...params.promptArgs, ...markerPromptArgs(params.marker) },
		promptFile: params.promptFile,
	});

	if (!markerExists(params.marker)) {
		throw new Error(`${params.name} finished without a completion marker.`);
	}

	return result;
}

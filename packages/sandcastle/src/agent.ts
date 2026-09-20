/*
 * Agent providers (dirac plus the @ai-hero/sandcastle backends), the marker
 * completion proxy, prompt-context skills, and the issue-metadata seam.
 *
 * This module is the public entry point for agent instantiation: `createAgent`
 * and `resolveBackendEffort` dispatch to the per-backend provider adapters in
 * `src/providers/` and wrap the result with `withMarkerCompletion`. All other
 * public symbols are re-exported here (and via `src/main.ts`) for backwards
 * compatibility.
 */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { claudeCodeProvider } from "./providers/claude-code.js";
import { codexProvider } from "./providers/codex.js";
import { copilotProvider } from "./providers/copilot.js";
import { cursorProvider } from "./providers/cursor.js";
import { diracProvider } from "./providers/dirac.js";
import { withMarkerCompletion } from "./providers/marker.js";
import { opencodeProvider } from "./providers/opencode.js";
import { piProvider } from "./providers/pi.js";
import type { AgentBackend, SandcastleEffort } from "./types.js";

export { fetchIssueLabels, issueMetadata, issueView } from "./issue-metadata.js";
export { skillsForPrompt, uniqueSkills } from "./prompts/skills.js";
export { diracProvider as diracAgent } from "./providers/dirac.js";
export { withMarkerCompletion } from "./providers/marker.js";

/**
 * Backend effort levels. "max" is a first-class level in dirac (see
 * `OPENAI_REASONING_EFFORT_OPTIONS` in dirac's `src/shared/storage/types.ts`) and is forwarded
 * untouched to dirac/claude-code. Backends whose CLIs cap out at "xhigh" (pi, codex) map "max" down
 * to "xhigh".
 */
export function resolveBackendEffort(effort: string, backend?: AgentBackend): SandcastleEffort {
	if (effort !== "max") {
		return effort as SandcastleEffort;
	}

	return backend === "dirac" || backend === "claude-code" ? "max" : "xhigh";
}

export function createAgent(
	backend: AgentBackend,
	model: string,
	effort: string,
	markerPath: string,
): AgentProvider {
	const resolvedEffort = resolveBackendEffort(effort, backend);
	let inner: AgentProvider;
	switch (backend) {
		case "claude-code": {
			inner = claudeCodeProvider(model, effort as SandcastleEffort);
			break;
		}
		case "codex": {
			inner = codexProvider(model, resolvedEffort);
			break;
		}
		case "copilot": {
			inner = copilotProvider(model, effort as SandcastleEffort);
			break;
		}
		case "cursor": {
			inner = cursorProvider(model, effort as SandcastleEffort);
			break;
		}
		case "dirac": {
			// Dirac natively supports "max" (OPENAI_REASONING_EFFORT_OPTIONS), so no downgrade.
			inner = diracProvider(model, {
				effort: resolvedEffort,
				env: {
					OPENAI_API_BASE: process.env.OPENAI_API_BASE ?? "https://router.bynara.id/v1",
					OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
				},
			});
			break;
		}
		case "opencode": {
			inner = opencodeProvider(model, effort as SandcastleEffort);
			break;
		}
		case "pi": {
			inner = piProvider(model, resolvedEffort);
			break;
		}
	}

	return withMarkerCompletion(inner, markerPath);
}

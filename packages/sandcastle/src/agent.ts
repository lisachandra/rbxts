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
import { assertZcodeModelSelectable } from "./providers/zcode-preflight.js";
import { zcodeProvider } from "./providers/zcode.js";
import type { AgentBackend, SandcastleEffort } from "./types.js";

export { fetchIssueLabels, isIssueNumber, issueMetadata, issueView } from "./issue-metadata.js";
export { queueRulesForPrompt } from "./prompts/queue.js";
export { skillsForPrompt, uniqueSkills } from "./prompts/skills.js";
export { diracProvider as diracAgent, scopeForMarkerPath } from "./providers/dirac.js";
export { withMarkerCompletion } from "./providers/marker.js";
export { ZcodePreflightError } from "./providers/zcode-preflight.js";
export { zcodeProvider as zcodeAgent } from "./providers/zcode.js";

/**
 * Backend effort levels. "max" is a first-class level in dirac (see
 * `OPENAI_REASONING_EFFORT_OPTIONS` in dirac's `src/shared/storage/types.ts`) and is forwarded
 * untouched to dirac/claude-code/zcode. Backends whose CLIs cap out at "xhigh" (pi, codex) map
 * "max" down to "xhigh". zcode additionally only accepts the zcode-native levels a model registers
 * (`low|high|max` for glm/deepseek), so "xhigh" maps down to "high" there.
 */
export function resolveBackendEffort(effort: string, backend?: AgentBackend): SandcastleEffort {
	if (backend === "zcode") {
		if (effort === "max") {
			return "max";
		}

		// zcode has no "xhigh" thought level; glm/deepseek-class models accept "high".
		return effort === "xhigh" ? "high" : (effort as SandcastleEffort);
	}

	if (effort !== "max") {
		return effort as SandcastleEffort;
	}

	return backend === "dirac" || backend === "claude-code" ? "max" : "xhigh";
}

/**
 * - Builds the provider for one phase, marker completion included.
 * - @param backend - Which CLI drives the phase.
 * - @param model - Model id, in the backend's own namespace.
 * - @param effort - Workflow effort level; each adapter maps it to what its CLI accepts.
 * - @param markerPath - Completion marker the attempt must create.
 * - @param options.scope - Marker scope for the session store. Supplying it is what enables resume,
 *   and it is only meaningful for `dirac` and `zcode`: upstream gates `resumeSession` on the
 *   provider shipping `sessionStorage`, and only those two adapters build one. Asking for a single
 *   session on any other backend is refused elsewhere rather than quietly degrading here.
 * - @returns The backend's provider, wrapped in {@link withMarkerCompletion}.
 * - @remarks Two levels of mapping happen on the way in, and they are not interchangeable. This
 *   function resolves the effort once and each adapter then performs its own translation (`max` →
 *   `xhigh` for pi/codex, clamp to `high` for copilot, dropped for cursor/opencode). Which value
 *   each one receives:
 *
 *   - `pi`, `codex`, `zcode` get `resolveBackendEffort`'s answer, because their adapters assume it.
 *   - `dirac` also gets the resolved value, and for dirac that resolution is identity in effect: `max`
 *     stays `max`, since its CLI supports the level natively.
 *   - `claude-code`, `copilot`, `cursor`, `opencode` get the raw `effort`, because none of them caps
 *     `max` through `resolveBackendEffort` — copilot clamps to `high` inside its own adapter, and the
 *     other two discard the level with a warning.
 *
 *   `zcode` is checked before its provider is built: {@link assertZcodeModelSelectable} rejects a
 *   model the configured provider catalogs do not offer, so a typo fails before a run rather than
 *   inside one.
 */
export function createAgent(
	backend: AgentBackend,
	model: string,
	effort: string,
	markerPath: string,
	options?: {
		/** Marker scope for the session store; enables resume for dirac/zcode. */
		scope?: string;
	},
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
				...(options?.scope !== undefined ? { scope: options.scope } : {}),
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
		case "zcode": {
			assertZcodeModelSelectable(model, resolvedEffort);
			inner = zcodeProvider(model, {
				effort: resolvedEffort,
				...(options?.scope !== undefined ? { scope: options.scope } : {}),
			});
			break;
		}
	}

	return withMarkerCompletion(inner, markerPath);
}

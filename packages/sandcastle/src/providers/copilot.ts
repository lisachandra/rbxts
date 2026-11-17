/* Copilot provider adapter. */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

/**
 * - The Copilot provider, with effort clamped to its supported three-level range.
 * - @param model - Model id passed to Copilot.
 * - @param effort - Workflow effort level. Only `low` and `medium` survive; everything else becomes
 *   `high`, which is announced on stderr when it changes anything.
 * - @returns A provider that delegates to upstream's `copilot`.
 * - @remarks Copilot accepts `low|medium|high` only, so both `xhigh` and `max` land on `high`. The
 *   mapping is a clamp rather than a shift: `xhigh` is not lowered one step, it joins `max` at the
 *   ceiling, because Copilot has no level above `high` to distinguish it from.
 */
export function copilotProvider(model: string, effort: SandcastleEffort): AgentProvider {
	const copilotEffort = effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
	if (copilotEffort !== effort) {
		console.warn(
			`  ⚠ Effort "${effort}" is not supported by copilot; using "${copilotEffort}" (highest supported).`,
		);
	}

	return io.copilot(model, {
		effort: copilotEffort,
	});
}

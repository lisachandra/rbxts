/*
 * Copilot provider adapter.
 *
 * Delegates to `io.copilot`, mapping "max"/"xhigh" effort down to "high" (the
 * CLI's highest supported level).
 */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

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

/*
 * Pi provider adapter.
 *
 * Delegates to `io.pi`, capping "max" effort down to "xhigh" (the CLI's
 * highest supported level) and disabling session capture.
 */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

export function piProvider(model: string, effort: SandcastleEffort): AgentProvider {
	const resolvedEffort = effort === "max" ? "xhigh" : effort;
	if (resolvedEffort !== effort) {
		console.warn(
			`  ⚠ Effort "${effort}" is not supported by pi; using "${resolvedEffort}" (highest supported).`,
		);
	}

	return io.pi(model, {
		captureSessions: false,
		thinking: resolvedEffort as "low" | "high" | "xhigh" | "medium",
	});
}

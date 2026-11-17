/*
 * Codex provider adapter.
 *
 * Delegates to `io.codex`, capping "max" effort down to "xhigh" (the CLI's
 * highest supported level). Session capture is upstream's default: upstream owns
 * the session files and gates resume on its own `findByIdOnHost` precheck, while
 * sandcastle keeps only the id, per phase scope, in its own store.
 */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

export function codexProvider(model: string, effort: SandcastleEffort): AgentProvider {
	const resolvedEffort = effort === "max" ? "xhigh" : effort;
	if (resolvedEffort !== effort) {
		console.warn(
			`  ⚠ Effort "${effort}" is not supported by codex; using "${resolvedEffort}" (highest supported).`,
		);
	}

	return io.codex(model, {
		effort: resolvedEffort as "low" | "high" | "xhigh" | "medium",
	});
}

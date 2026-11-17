/* Codex provider adapter. */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

/**
 * - The codex provider, with effort capped at the CLI's highest level.
 * - @param model - Model id passed to codex.
 * - @param effort - Workflow effort level. `max` is downgraded to `xhigh` and reported on stderr.
 * - @returns A provider that delegates to upstream's `codex`.
 * - @remarks `xhigh` is codex's highest supported level, so `max` cannot be forwarded, and the
 *   downgrade is announced rather than silent.
 *
 *   Session capture is deliberately left at upstream's default, for the same reason as
 *   {@link piProvider}: codex owns its session files, and this package stores only the id it saw.
 */
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

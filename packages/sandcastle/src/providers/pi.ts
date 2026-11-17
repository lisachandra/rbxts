/* Pi provider adapter. */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

/**
 * - The pi provider, with effort capped at the CLI's highest level.
 * - @param model - Model id passed to pi.
 * - @param effort - Workflow effort level. `max` is downgraded to `xhigh` and reported on stderr.
 * - @returns A provider that delegates to upstream's `pi`.
 * - @remarks `xhigh` is the highest level pi's CLI accepts, so `max` cannot be forwarded. The
 *   downgrade is announced rather than silent: an operator who asked for `max` should not have to
 *   read the source to learn they got `xhigh`. pi receives the level as `thinking`, not `effort`.
 *
 *   Session capture is deliberately left at upstream's default. Upstream owns the session files and
 *   gates resume on its own `findByIdOnHost` precheck; sandcastle keeps only the id, per phase scope,
 *   in its own store.
 */
export function piProvider(model: string, effort: SandcastleEffort): AgentProvider {
	const resolvedEffort = effort === "max" ? "xhigh" : effort;
	if (resolvedEffort !== effort) {
		console.warn(
			`  ⚠ Effort "${effort}" is not supported by pi; using "${resolvedEffort}" (highest supported).`,
		);
	}

	return io.pi(model, {
		thinking: resolvedEffort as "low" | "high" | "xhigh" | "medium",
	});
}

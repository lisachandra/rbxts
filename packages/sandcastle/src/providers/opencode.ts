/* OpenCode provider adapter. */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

/**
 * - The OpenCode provider.
 * - @param model - Model id passed to OpenCode.
 * - @param effort - Ignored. OpenCode has no reasoning-effort control, so every level (including
 *   `max`) is dropped with a warning.
 * - @returns A provider that delegates to upstream's `opencode`.
 * - @remarks As with {@link cursorProvider}, the warning is unconditional: no level is honoured, so a
 *   conditional warning would misreport the ones it stayed quiet about.
 */
export function opencodeProvider(model: string, effort: SandcastleEffort): AgentProvider {
	console.warn(`  ⚠ Effort "${effort}" is not supported by opencode; ignoring.`);
	return io.opencode(model, {});
}

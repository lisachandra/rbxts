/*
 * OpenCode provider adapter.
 *
 * Delegates to `io.opencode`. OpenCode does not support reasoning effort
 * levels, so "max" (and any other value) is ignored with a warning.
 */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

export function opencodeProvider(model: string, effort: SandcastleEffort): AgentProvider {
	console.warn(`  ⚠ Effort "${effort}" is not supported by opencode; ignoring.`);
	return io.opencode(model, {});
}

/*
 * Cursor provider adapter.
 *
 * Delegates to `io.cursor`. Cursor does not support reasoning effort levels,
 * so "max" (and any other value) is ignored with a warning.
 */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

export function cursorProvider(model: string, effort: SandcastleEffort): AgentProvider {
	console.warn(`  ⚠ Effort "${effort}" is not supported by cursor; ignoring.`);
	return io.cursor(model, {});
}

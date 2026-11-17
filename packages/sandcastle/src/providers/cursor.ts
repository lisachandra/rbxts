/* Cursor provider adapter. */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

/**
 * - The Cursor provider.
 * - @param model - Model id passed to Cursor.
 * - @param effort - Ignored. Cursor has no reasoning-effort control, so every level (including `max`)
 *   is dropped with a warning.
 * - @returns A provider that delegates to upstream's `cursor`.
 * - @remarks The warning is unconditional rather than conditional on `max`, because there is no level
 *   Cursor honours: silence here would imply the requested effort took effect.
 */
export function cursorProvider(model: string, effort: SandcastleEffort): AgentProvider {
	console.warn(`  ⚠ Effort "${effort}" is not supported by cursor; ignoring.`);
	return io.cursor(model, {});
}

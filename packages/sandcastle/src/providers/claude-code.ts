/* Claude Code provider adapter. */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

/**
 * - The Claude Code provider.
 * - @param model - Model id passed to Claude Code.
 * - @param effort - Workflow effort level, forwarded unchanged.
 * - @returns A provider that delegates to upstream's `claudeCode`.
 * - @remarks This is the adapter that does _not_ cap `max`: Claude Code supports it natively, so the
 *   level a caller asks for is the level that runs. The contrast is worth stating because the other
 *   adapters in this directory all clamp something, and a reader who assumes they behave alike will
 *   misread this one.
 *
 *   Session capture is upstream's default: Claude Code owns the session files and gates resume on its
 *   own `findByIdOnHost` precheck, while sandcastle keeps only the id, per phase scope, in its
 *   store.
 */
export function claudeCodeProvider(model: string, effort: SandcastleEffort): AgentProvider {
	return io.claudeCode(model, {
		effort: effort as "low" | "max" | "high" | "xhigh" | "medium",
	});
}

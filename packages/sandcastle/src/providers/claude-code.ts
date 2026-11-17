/*
 * Claude Code provider adapter.
 *
 * Delegates to `io.claudeCode`, preserving "max" effort (natively supported).
 * Session capture is upstream's default: upstream owns the session files and
 * gates resume on its own `findByIdOnHost` precheck, while sandcastle keeps only
 * the id, per phase scope, in its own store.
 */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

export function claudeCodeProvider(model: string, effort: SandcastleEffort): AgentProvider {
	return io.claudeCode(model, {
		effort: effort as "low" | "max" | "high" | "xhigh" | "medium",
	});
}

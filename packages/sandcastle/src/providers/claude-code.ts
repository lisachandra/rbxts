/*
 * Claude Code provider adapter.
 *
 * Delegates to `io.claudeCode`, preserving "max" effort (natively supported)
 * and disabling session capture.
 */

import type { AgentProvider } from "@ai-hero/sandcastle";

import { io } from "../runtime.js";
import type { SandcastleEffort } from "../types.js";

export function claudeCodeProvider(model: string, effort: SandcastleEffort): AgentProvider {
	return io.claudeCode(model, {
		captureSessions: false,
		effort: effort as "low" | "max" | "high" | "xhigh" | "medium",
	});
}

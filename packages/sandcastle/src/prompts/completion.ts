/*
 * The completion contract every marker-backed phase ends on.
 *
 * The block used to be copied into all six prompt files, which made the runner's only completion
 * signal a six-way maintenance hazard: a phase whose copy drifted, or whose copy an edit dropped,
 * runs to the end of its work and then fails on a missing marker. One renderer now owns the
 * wording, and `agent.test.ts` fails any prompt file that stops referencing `{{COMPLETION}}`.
 */

import { dirname } from "node:path";

/** POSIX-style paths for prompt substitution; agents run under bash. */
function posix(value: string): string {
	return value.replaceAll("\\", "/");
}

/** What a phase must have finished before its marker may appear. */
export interface CompletionContext {
	/** Phrase completing "once …", e.g. "the `<plan>` block is printed". */
	before?: string;
}

/**
 * - Renders the completion block a marker-backed phase ends on.
 * - @param path - Host path of the marker file the phase must create last.
 * - @param context - The step the marker must follow, when it is not the whole phase.
 * - @returns The block's text, with the marker command ready to paste into a shell.
 * - @remarks The marker file is the runner's only completion signal, so the block states the work
 *   that must already be done, the command that creates it, and the state the phase leaves behind.
 */
export function completionRules(path: string, context: CompletionContext = {}): string {
	const before = context.before ?? "every required step above is finished";

	return [
		`Create the completion marker as your final action, once ${before}:`,
		"",
		"```",
		`mkdir -p "${posix(dirname(path))}" && touch "${posix(path)}"`,
		"```",
		"",
		"That file is how the runner knows the phase is done, so it comes last: any process you",
		"spawned has already exited, nothing is still running behind it, and your final response",
		"carries the summary — no completion token, no marker path.",
	].join("\n");
}

/**
 * - Builds the prompt arguments a marker-backed phase needs.
 * - @param path - Host path of the marker file the phase must create last.
 * - @param context - The step the marker must follow, when it is not the whole phase.
 * - @returns `{{COMPLETION}}`'s value.
 * - @remarks The path is interpolated here rather than left as a placeholder, so a nested
 *   substitution is never what the agent ends up reading.
 */
export function completionPromptArgs(
	path: string,
	context: CompletionContext = {},
): { COMPLETION: string } {
	return { COMPLETION: completionRules(path, context) };
}

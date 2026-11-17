/*
 * The environment warning a phase receives when its worktree setup failed.
 *
 * Both the issue phases and the integration phases swallow a setup failure under
 * `--ignore-setup`. The agent that then runs has no way to tell a broken environment from a broken
 * change, and the #498 implement phase spent its whole budget diagnosing one main had already
 * fixed. The prompt files interpolate `{{SETUP_NOTE}}` verbatim, so this renderer must always
 * produce a string — the empty one when setup succeeded.
 */

/**
 * - Render the `SETUP_NOTE` paragraph for a phase prompt.
 * - @param failure - The one-line setup failure a caller swallowed, or `undefined` when setup passed.
 * - @returns A warning paragraph, or the empty string so the placeholder never leaks.
 * - @remarks The note names what broke and forbids repair: an agent that starts fixing the
 *   environment has left the phase's actual work, and the same environment is reused next run.
 */
export function setupNoteFor(failure: string | undefined): string {
	if (failure === undefined || failure === "") {
		return "";
	}

	return [
		"Environment warning — the worktree setup commands FAILED and the run continued anyway:",
		`    ${failure}`,
		"The environment may be broken. Verify what you depend on before trusting it (builds, tests, node_modules, submodules).",
		"Do not spend the phase repairing the environment; work around what you can, and report the breakage in your final response.",
	].join("\n");
}

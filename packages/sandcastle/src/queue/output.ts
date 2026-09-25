/*
 * Queue output channels.
 *
 * `--json` means stdout is the machine channel and nothing else may write to it: every human line —
 * progress, drift warnings, dry-run notes, commit notices — goes to stderr through `emitText`. That
 * makes `queue list --json` a single object, `queue run --json` one object per decision (JSONL), and
 * every other subcommand's stdout parseable without a filter.
 */

import type { CliOptions } from "../cli.js";

/** Prints a human line on stdout, or on stderr when `--json` owns stdout. */
export function emitText(options: CliOptions, line: string): void {
	if (options.jsonOut) {
		console.error(line);
	} else {
		console.log(line);
	}
}

/** Prints one compact JSON object on stdout. */
export function emitJson(value: unknown): void {
	console.log(JSON.stringify(value));
}

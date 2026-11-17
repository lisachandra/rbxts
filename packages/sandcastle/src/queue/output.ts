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

/**
 * Prints one JSON value on stdout.
 *
 * @param value - The payload.
 * @param pretty - Indent with two spaces. The document subcommands (`list`, `check`, `graph`, and
 *   the disabled-queue answer) pass `true` because their stdout is a single object a human may
 *   read; the JSONL streams leave it off, because one pretty-printed record spans many lines and
 *   defeats the one-object-per-line contract a consumer parses.
 */
export function emitJson(value: unknown, pretty = false): void {
	console.log(pretty ? JSON.stringify(value, undefined, 2) : JSON.stringify(value));
}

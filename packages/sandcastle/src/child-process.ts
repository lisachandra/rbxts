import type { ExecFileSyncOptions } from "node:child_process";

import { io } from "./runtime.js";

/**
 * A command expressed as a program and its arguments, never as a pre-joined string.
 *
 * @remarks
 *   The argv form is the safe one: nothing in `args` is ever parsed by a shell, so a value cannot
 *   end its argument no matter what it contains. Use {@link toShellCommand} only where an upstream
 *   API demands a single string (`@ai-hero/sandcastle` spawns through `sh -c`), and never build
 *   that string by interpolation.
 */
export interface CommandSpec {
	/** The arguments, in order, each one argument. */
	args: ReadonlyArray<string>;
	/** The program to run. */
	file: string;
}

/**
 * The shape a session id must have to be persisted or replayed.
 *
 * @remarks
 *   A session id is echoed by the agent on its own stdout, so a prompt-injected agent chooses it.
 *   It is then persisted and interpolated into a provider command on the next retry. Restricting it
 *   to a token alphabet — no spaces, no quotes, no `$`, no `;`, no backticks, no `/` — keeps it
 *   inert in every form the command takes, which is why quoting is not the only defence. Rejecting
 *   at capture is better than quoting alone: a session id is never legitimately anything else. A
 *   leading `-` is excluded too, and that is not cosmetic: a dash-prefixed value is read as an
 *   option by the provider's own argument parser before it ever reaches a shell, and zcode's
 *   `parseArgs` ignores unknown flags — so `--dangerously-skip-permissions` as a session id would
 *   silently escalate the next attempt.
 */
const SESSION_ID_PATTERN = /^(?!-)[A-Za-z0-9._:-]{1,128}$/;

/**
 * Reports whether a value is a well-formed session id.
 *
 * @param value - The candidate session id.
 * @returns `true` when the value matches the token pattern.
 */
export function isValidSessionId(value: string): boolean {
	return SESSION_ID_PATTERN.test(value);
}

/**
 * Quotes one value so a POSIX shell reads it as exactly one word, whatever it contains.
 *
 * @remarks
 *   Single quotes suppress every expansion the shell performs — `$`, backticks, `;`, newlines,
 *   globs — and the only character that needs handling is the single quote itself, which closes the
 *   run and is re-emitted escaped (`'\''`). This is the only quoting function in the package; a
 *   provider that needs a quoted value passes its arguments to {@link toShellCommand} instead of
 *   formatting one itself.
 * @param value - The value to quote.
 * @returns The value, quoted as one shell word.
 */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Renders a spec as one shell command string, quoting every argument by construction.
 *
 * @param spec - The program and its arguments.
 * @returns The command string; each element of `args` is quoted, so none can change the argv.
 */
export function toShellCommand(spec: CommandSpec): string {
	return [spec.file, ...spec.args].map(shellQuote).join(" ");
}

/**
 * Runs a spec without a shell.
 *
 * @remarks
 *   The default way to spawn anything. Because there is no shell, `args` is delivered as argv and
 *   no quoting is required or performed — a value containing `;` or `$(…)` is just a string the
 *   program receives.
 * @param spec - The program and its arguments.
 * @param options - Node's `execFileSync` options, minus `argv`.
 * @returns The child's stdout as a string.
 */
export function runCommand(spec: CommandSpec, options: ExecFileSyncOptions = {}): string {
	return io.execFileSync(spec.file, [...spec.args], { encoding: "utf-8", ...options }).toString();
}

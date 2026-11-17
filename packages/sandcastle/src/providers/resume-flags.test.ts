/*
 * Resume flags for the upstream-backed providers, asserted against the command the runner would
 * actually spawn.
 *
 * The property under test is not "the adapter stopped disabling capture" — that is `providers.test.ts`
 * — but "a captured id reaches the argv". Three things have to line up for that, and each is easy to
 * lose on its own: the provider keeps upstream's session storage, the marker proxy forwards it, and
 * the provider's own `buildPrintCommand` handles `resumeSession`. These specs drive the composed
 * provider (`createAgent` → `withMarkerCompletion`) so a break in any of the three shows up as a
 * missing flag rather than as three separately passing units.
 *
 * The real upstream adapters are used deliberately: stubbing them would test this file's stub.
 * Assertions decode the argv rather than matching the formatted string, as `dirac.test.ts` does —
 * what matters is the argument list the wrapper receives, not the quoting the seam happens to emit.
 */

import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { createAgent } from "../agent.js";
import { markerPath } from "../markers.js";
import { registerTestHooks } from "../test-helpers.js";
import type { AgentBackend } from "../types.js";

registerTestHooks();

const SESSION_ID = "0199c0ffee-session";

/** Every backend that can resume through upstream's session storage. */
const RESUMABLE: ReadonlyArray<AgentBackend> = ["pi", "codex", "claude-code"];

/** Split a command the way `dirac.test.ts` does, so a value is compared, not its quoting. */
function words(command: string): Array<string> {
	return command.split(" ").map((word) => word.replaceAll(/^'|'$/g, ""));
}

/**
 * The argv the marker wrapper hands to `bash -c`.
 *
 * The composed command carries two quoting layers: `toShellCommand` quotes the wrapper's arguments,
 * and the provider's own command is one of them, already quoted as a single word. Splitting the
 * outer string on spaces would therefore cut the inner command apart at its own spaces, so this
 * takes everything after the standalone `'--'` argument — the inner command is the last argument
 * the wrapper receives — strips its outer quotes, and un-escapes the inner layer (`'\''` per
 * embedded quote). What comes back is the argument list the agent process is actually given, which
 * is what decides whether it resumes.
 */
function wrapperArgv(command: string): Array<string> {
	const separator = "'--' ";
	const start = command.indexOf(separator);
	assert.notEqual(start, -1, `no '--' before the inner command in ${command}`);
	const quoted = command.slice(start + separator.length);
	assert.ok(
		quoted.startsWith("'") && quoted.endsWith("'"),
		`unquoted inner command in ${command}`,
	);
	const unescaped = quoted.slice(1, -1).replaceAll(String.raw`'\''`, "'");
	return words(unescaped);
}

/** The command string the sandbox would spawn, on a resumed run. */
function resumedCommand(backend: AgentBackend): string {
	const provider = createAgent(backend, "some-model", "low", markerPath("resume-flag"));
	return provider.buildPrintCommand({
		dangerouslySkipPermissions: true,
		prompt: "do the thing",
		resumeSession: SESSION_ID,
	}).command;
}

/** The argv the sandbox would spawn, on a resumed run. */
function resumedArgv(backend: AgentBackend): Array<string> {
	return wrapperArgv(resumedCommand(backend));
}

/** The same argv, on an ordinary first attempt. */
function freshArgv(backend: AgentBackend): Array<string> {
	const provider = createAgent(backend, "some-model", "low", markerPath("resume-flag"));
	return wrapperArgv(
		provider.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "do the thing",
		}).command,
	);
}

/** The word after `flag`, or `undefined` when the flag is absent. */
function valueOf(argv: Array<string>, flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index === -1 ? undefined : argv[index + 1];
}

describe("resume flags on the composed provider", () => {
	test("should carry the captured id into pi's --session flag", () => {
		assert.equal(valueOf(resumedArgv("pi"), "--session"), SESSION_ID);
	});

	test("should resume codex with `codex exec resume <id>`", () => {
		assert.equal(valueOf(resumedArgv("codex"), "resume"), SESSION_ID);
	});

	test("should resume claude-code with --resume", () => {
		/*
		 * No `--fork-session`: upstream emits it only when the caller also passes `forkSession`, and the
		 * phase runner does not — a retry continues the same conversation rather than branching it. If
		 * that ever changes, this spec and the run option change together.
		 */
		const argv = resumedArgv("claude-code");
		assert.equal(valueOf(argv, "--resume"), SESSION_ID);
		assert.equal(argv.includes("--fork-session"), false, JSON.stringify(argv));
	});

	test("should not resume any of the three on a first attempt", () => {
		/*
		 * The guard against "every run silently becomes a resume": a resume flag built from no id is
		 * either an argv error or, worse, a session the agent never had.
		 */
		for (const backend of RESUMABLE) {
			const argv = freshArgv(backend);
			assert.equal(argv.includes(SESSION_ID), false, backend);
			assert.equal(
				argv.some((word) => word.startsWith("--resume")),
				false,
				backend,
			);
		}
	});

	test("should keep the marker wrapper in front of every resumed command", () => {
		/*
		 * The flag is useless if composing the provider dropped the wrapper — the wrapper is what turns
		 * a clean exit into the protocol line the phase runner waits for. Checked on the composed string
		 * rather than the inner argv: the wrapper is the outer program, so it never appears inside the
		 * command it runs.
		 */
		for (const backend of RESUMABLE) {
			assert.match(resumedCommand(backend), /agent-wrapper\.sh/u, backend);
		}
	});

	test("should keep upstream's session storage reachable through the marker proxy", () => {
		/*
		 * Upstream gates `resumeSession` on `provider.sessionStorage.findByIdOnHost`; a provider without
		 * it does not fail quietly, it refuses the run. The proxy must forward what the adapter built.
		 */
		for (const backend of RESUMABLE) {
			const provider = createAgent(backend, "some-model", "low", markerPath("resume-flag"));
			assert.notEqual(provider.sessionStorage, undefined, backend);
			assert.equal(provider.captureSessions, true, backend);
		}
	});
});

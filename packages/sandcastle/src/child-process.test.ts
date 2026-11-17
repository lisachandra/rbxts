import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { shellQuote, toShellCommand } from "./child-process.js";

/*
 * Every value here can arrive from somewhere an agent controls: a session id is echoed on the
 * agent's own stdout and replayed on retry, and a base ref can come from a state file. None of them
 * may be able to end its argument.
 */
const hostileValues: Array<[label: string, value: string]> = [
	["semicolon", "x; echo pwned"],
	["command substitution", "x$(echo pwned)"],
	["backtick substitution", "x`echo pwned`"],
	["space", "x y"],
	["newline", "x\necho pwned"],
	["blank", ""],
	["leading dash", "--dangerously-skip-permissions"],
	["quotes", "x'y\"z"],
	["backslash", "x\\y"],
	["glob", "x*"],
];

/**
 * Splits a POSIX shell word sequence into words, understanding exactly the quoting the seam emits:
 * a single-quoted run, with `'\''` closing, escaping, and reopening.
 *
 * This is a decoder, not the encoder — so a value that escaped its quoting shows up as extra words
 * or as altered text. That is what makes the assertions falsifiable without spawning a shell.
 */
function decodeWords(command: string): Array<string> {
	const words: Array<string> = [];
	let current = "";
	let inWord = false;

	for (let index = 0; index < command.length; index++) {
		const char = command[index]!;

		if (char === "'") {
			inWord = true;
			index++;
			while (index < command.length && command[index] !== "'") {
				current += command[index];
				index++;
			}

			continue;
		}

		if (char === "\\") {
			inWord = true;
			current += command[index + 1] ?? "";
			index++;
			continue;
		}

		if (char === " ") {
			if (inWord) {
				words.push(current);
				current = "";
				inWord = false;
			}

			continue;
		}

		inWord = true;
		current += char;
	}

	if (inWord) {
		words.push(current);
	}

	return words;
}

describe("child-process seam", () => {
	test("quotes a value into exactly one shell word", () => {
		for (const [label, value] of hostileValues) {
			assert.deepEqual(
				decodeWords(shellQuote(value)),
				[value],
				`${label}: quoting must preserve the value as one word`,
			);
		}
	});

	test("builds a command whose argv survives any hostile value", () => {
		for (const [label, value] of hostileValues) {
			const spec = { args: ["--model", value, "tail"], file: "provider" };

			assert.deepEqual(
				decodeWords(toShellCommand(spec)),
				["provider", "--model", value, "tail"],
				`${label}: the value must stay in its own argument`,
			);
		}
	});

	test("keeps a leading-dash value inside its argument slot", () => {
		const spec = {
			args: ["--resume-session", "--dangerously-skip-permissions"],
			file: "agent",
		};

		// The value is data for the flag before it; it is not a third argument.
		assert.deepEqual(decodeWords(toShellCommand(spec)), [
			"agent",
			"--resume-session",
			"--dangerously-skip-permissions",
		]);
	});
});

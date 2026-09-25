/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseArgs, printHelp } from "./cli.js";
import { helpTopicKey } from "./help.js";
import { queueSubcommands } from "./queue/commands.js";
import { registerTestHooks } from "./test-helpers.js";

registerTestHooks();

/** Captures what a help render prints, so topics can be asserted as text. */
function capture(run: () => void): string {
	const lines: Array<string> = [];
	const original = console.log;
	console.log = ((...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	}) as typeof console.log;

	try {
		run();
	} finally {
		console.log = original;
	}

	return lines.join("\n");
}

const commandInvocations: Array<Array<string>> = [
	["issue"],
	["issue-sequence"],
	["merge"],
	["merge-integrations"],
	["setup"],
	["integration-abort"],
	["integration-cleanup"],
	["integration-resume"],
	["integration-status"],
];

describe("help topics", () => {
	test("--help never fails a requirement check, for any command or queue subcommand", () => {
		const invocations: Array<Array<string>> = [
			...commandInvocations,
			["queue"],
			...queueSubcommands.map((subcommand) => ["queue", subcommand]),
		];

		for (const argv of invocations) {
			const label = argv.join(" ");
			const options = parseArgs([...argv, "--help"]);
			assert.equal(options.help, true, `${label} --help must set help`);
			assert.doesNotThrow(() => {
				printHelp(helpTopicKey(options));
			}, `${label} --help must print`);
		}
	});

	test("every command and queue subcommand resolves to its own topic", () => {
		for (const argv of commandInvocations) {
			assert.equal(helpTopicKey(parseArgs([...argv, "--help"])), argv[0]);
		}

		for (const subcommand of queueSubcommands) {
			assert.equal(helpTopicKey(parseArgs(["queue", subcommand, "--help"])), subcommand);
		}

		assert.equal(helpTopicKey(parseArgs(["queue", "--help"])), "queue");
	});

	test("a topic prints usage, options, and the global pointer", () => {
		const text = capture(() => {
			printHelp("run");
		});

		assert.match(text, /^Sandcastle queue run/u);
		assert.match(text, /Usage:/u);
		assert.match(text, /--max-issues <n>/u);
		assert.match(text, /Global index: pnpm sandcastle --help/u);
		assert.doesNotMatch(text, /Sequential issue workflow/u);
	});

	test("the global index still prints when no topic is known", () => {
		const text = capture(() => {
			printHelp(helpTopicKey(parseArgs(["--help"])));
			printHelp();
		});

		assert.match(text, /Issue workflow:/u);
		assert.match(text, /Queue workflow \(batch manifest \+ live view\):/u);
		assert.match(text, /pnpm sandcastle queue prune --closed/u);
	});
});

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { commaSeparated, parseArgs, printHelp } from "./cli.js";
import { registerTestHooks, tmpRoot, withEnv } from "./test-helpers.js";

registerTestHooks();

describe("commaSeparated / parseArgs", () => {
	test("commaSeparated rejects empty values", () => {
		assert.throws(() => commaSeparated(undefined, "--issues"), /requires a value/);
		assert.throws(() => commaSeparated("", "--issues"), /requires a value/);
		assert.throws(() => commaSeparated(" , , ", "--issues"), /at least one value/);
		assert.deepEqual(commaSeparated("1, 2 ,3", "--issues"), ["1", "2", "3"]);
	});

	test("parseArgs parses issue flags and defaults", () => {
		withEnv(
			{
				DIRAC_SANDCASTLE_MODEL: "env-model",
				SANDCASTLE_AGENT: "dirac",
				SANDCASTLE_EFFORT: "high",
			},
			() => {
				const options = parseArgs([
					"--",
					"--issue",
					"42",
					"--resume",
					"--phase",
					"implement",
					"--force",
					"design",
					"--status",
					"-c",
					"3",
					"--base",
					"main",
					"--ignore-setup",
				]);
				assert.equal(options.command, "issue");
				assert.equal(options.issueNumber, "42");
				assert.equal(options.resume, true);
				assert.equal(options.phase, "implement");
				assert.equal(options.force, "design");
				assert.equal(options.status, true);
				assert.equal(options.concurrency, 3);
				assert.equal(options.model, "env-model");
				// SANDCASTLE_EFFORT is deprecated; config.effort wins.
				assert.equal(options.effort, "xhigh");
				assert.equal(options.ignoreSetup, true);
			},
		);
	});

	test("parseArgs defaults ignoreSetup to false", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			const options = parseArgs(["--issue", "1"]);
			assert.equal(options.ignoreSetup, false);
		});
	});

	test("parseArgs accepts bare --force and positional issue", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			const options = parseArgs(["151", "--force", "--agent", "dirac", "--effort", "low"]);
			assert.equal(options.issueNumber, "151");
			assert.equal(options.force, true);
			assert.equal(options.agentBackend, "dirac");
			assert.equal(options.effort, "low");
		});
	});

	test("parseArgs validates agent, effort, phase, and unknown args", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			assert.throws(
				() => parseArgs(["--issue", "1", "--agent", "nope"]),
				/claude-code, codex, copilot, cursor, dirac, opencode, pi/,
			);
			assert.throws(
				() => parseArgs(["--issue", "1", "--effort", "nope"]),
				/low, medium, high, xhigh/,
			);
			assert.throws(
				() => parseArgs(["--issue", "1", "--phase", "nope"]),
				/design, implement, review/,
			);
			assert.throws(() => parseArgs(["--issue", "1", "--unknown"]), /Unknown argument/);
		});
	});

	test("parseArgs enforces command exclusivity and worktree rules", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			assert.throws(
				() => parseArgs(["merge", "--issues", "1", "--integrations", "a", "--name", "x"]),
				/Do not combine --issues and --integrations/,
			);
			assert.throws(
				() => parseArgs(["merge", "--integrations", "a", "--name", "x"]),
				/accepts --issues/,
			);
			assert.throws(
				() => parseArgs(["merge-integrations", "--issues", "1", "--name", "x"]),
				/accepts --integrations/,
			);
			assert.throws(
				() => parseArgs(["merge", "--name", "x", "--issues", "1", "--worktree", tmpRoot]),
				/--worktree is only supported/,
			);
			assert.throws(
				() => parseArgs(["--issue", "all", "--worktree", tmpRoot]),
				/--worktree cannot be used with --issue all/,
			);
			assert.throws(() => parseArgs(["--worktree"]), /requires an existing path/);
			assert.throws(
				() => parseArgs(["issue-sequence", "--sequential", "1", "merge"]),
				/Only one Sandcastle command/,
			);
		});
	});

	test("parseArgs requires model unless help", () => {
		withEnv(
			{
				DIRAC_SANDCASTLE_MODEL: undefined,
				PI_SANDCASTLE_MODEL: undefined,
				SANDCASTLE_MODEL: undefined,
			},
			() => {
				assert.throws(() => parseArgs(["--issue", "1"]), /No model configured/);
				const help = parseArgs(["--help"]);
				assert.equal(help.help, true);
				assert.equal(help.model, "");
			},
		);
	});

	test("parseArgs uses backend-specific model env keys", () => {
		withEnv(
			{
				DIRAC_SANDCASTLE_MODEL: "dirac-model",
				PI_SANDCASTLE_MODEL: "pi-model",
				SANDCASTLE_MODEL: undefined,
			},
			() => {
				assert.equal(parseArgs(["--issue", "1", "--agent", "dirac"]).model, "dirac-model");
				assert.equal(parseArgs(["--issue", "1", "--agent", "pi"]).model, "pi-model");
			},
		);
	});

	test("parseArgs accepts native backends with explicit models", () => {
		withEnv(
			{
				DIRAC_SANDCASTLE_MODEL: undefined,
				PI_SANDCASTLE_MODEL: undefined,
				SANDCASTLE_MODEL: undefined,
			},
			() => {
				const options = parseArgs(["--issue", "1", "--agent", "codex", "--model", "cm"]);
				assert.equal(options.agentBackend, "codex");
				assert.equal(options.model, "cm");
			},
		);
	});

	test("parseArgs parses integration and sequential commands", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			const merge = parseArgs([
				"merge",
				"--name",
				"wave-1",
				"--issues",
				"1,2",
				"--allow-unreviewed",
				"--model",
				"cli-model",
			]);
			assert.equal(merge.command, "merge");
			assert.deepEqual(merge.issueNumbers, ["1", "2"]);
			assert.equal(merge.allowUnreviewed, true);
			assert.equal(merge.model, "cli-model");

			const sequence = parseArgs([
				"issue-sequence",
				"--sequential",
				"10,11",
				"--base",
				"sandcastle/issue-9",
			]);
			assert.equal(sequence.command, "issue-sequence");
			assert.deepEqual(sequence.sequentialIssues, ["10", "11"]);
			assert.equal(sequence.base, "sandcastle/issue-9");
		});
	});
});

test("printHelp prints usage without throwing", () => {
	printHelp();
});

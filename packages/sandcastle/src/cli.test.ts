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
					"--skip-setup",
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
				assert.equal(options.skipSetup, true);
			},
		);
	});

	test("parseArgs defaults ignoreSetup to false", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			const options = parseArgs(["--issue", "1"]);
			assert.equal(options.ignoreSetup, false);
			assert.equal(options.skipSetup, false);
		});
	});

	test("parseArgs parses --skip-setup independently", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			const options = parseArgs(["--issue", "1", "--skip-setup"]);
			assert.equal(options.skipSetup, true);
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

	test("parseArgs parses the setup command without requiring a model", () => {
		withEnv(
			{
				DIRAC_SANDCASTLE_MODEL: undefined,
				PI_SANDCASTLE_MODEL: undefined,
				SANDCASTLE_MODEL: undefined,
			},
			() => {
				const options = parseArgs([
					"setup",
					"--branch",
					"sandcastle/issue-1",
					"--base",
					"main",
					"--ignore-setup",
					"--skip-setup",
					"--dry-run",
				]);
				assert.equal(options.command, "setup");
				assert.equal(options.branch, "sandcastle/issue-1");
				assert.equal(options.base, "main");
				assert.equal(options.ignoreSetup, true);
				assert.equal(options.skipSetup, true);
				assert.equal(options.dryRun, true);
				// setup never requires a model.
				assert.equal(options.model, "");

				const worktree = parseArgs(["setup", "--worktree", tmpRoot]);
				assert.equal(worktree.command, "setup");
				assert.equal(worktree.worktree, tmpRoot);

				const bare = parseArgs(["setup"]);
				assert.equal(bare.command, "setup");
				assert.equal(bare.branch, "");
				assert.equal(bare.worktree, undefined);
			},
		);
	});

	test("parseArgs enforces setup flag rules", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			assert.throws(
				() => parseArgs(["--issue", "1", "--branch", "x"]),
				/--branch is only supported for the setup command/,
			);
			assert.throws(
				() => parseArgs(["setup", "--branch", "x", "--worktree", tmpRoot]),
				/--branch cannot be combined with --worktree/,
			);
			assert.throws(() => parseArgs(["setup", "--branch"]), /--branch requires a value/);
			assert.throws(
				() => parseArgs(["setup", "issue-sequence", "--sequential", "1"]),
				/Only one Sandcastle command/,
			);
		});
	});

	test("parseArgs resolves per-step overrides", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "workflow-model" }, () => {
			const options = parseArgs([
				"--issue",
				"1",
				"--design-model",
				"design-m",
				"--design-effort",
				"low",
				"--implement-agent",
				"codex",
				"--model",
				"codex-m",
			]);
			assert.equal(options.steps.design.model, "design-m");
			assert.equal(options.steps.design.effort, "low");
			assert.equal(options.steps.design.agentBackend, "dirac");
			assert.equal(options.steps.implement.agentBackend, "codex");
			assert.equal(options.steps.implement.model, "codex-m");
			assert.equal(options.steps.review.model, "codex-m");
		});
	});

	test("parseArgs rejects invalid per-step values", () => {
		withEnv({ DIRAC_SANDCASTLE_MODEL: "m" }, () => {
			assert.throws(
				() => parseArgs(["--issue", "1", "--review-agent", "nope"]),
				/must be one of/,
			);
			assert.throws(
				() => parseArgs(["--issue", "1", "--design-effort", "nope"]),
				/must be one of/,
			);
			assert.throws(() => parseArgs(["--issue", "1", "--resolve-model"]), /requires a value/);
		});
	});

	describe("queue command", () => {
		test("parseArgs parses queue subcommands and placement flags", () => {
			const add = parseArgs([
				"queue",
				"add",
				"--issue",
				"5",
				"--sequence",
				"U2",
				"--after",
				"4",
			]);
			assert.equal(add.command, "queue");
			assert.equal(add.queueSubcommand, "add");
			assert.equal(add.issueNumber, "5");
			assert.equal(add.queueSequence, "U2");
			assert.equal(add.after, "4");
			// Parsing a queue command succeeds without any model configuration.

			const gated = parseArgs([
				"queue",
				"add",
				"--issue",
				"6",
				"--gated",
				"--reason",
				"blocked",
			]);
			assert.equal(gated.queueBucket, "gated");
			assert.equal(gated.reason, "blocked");

			const human = parseArgs([
				"queue",
				"add",
				"--issue",
				"7",
				"--human",
				"--reason",
				"decide",
			]);
			assert.equal(human.queueBucket, "human");

			const sequence = parseArgs([
				"queue",
				"sequence",
				"--name",
				"U2",
				"--issues",
				"1,2",
				"--after",
				"audio-seam-work",
				"--notes",
				"order matters",
			]);
			assert.equal(sequence.queueSubcommand, "sequence");
			assert.equal(sequence.integrationName, "U2");
			assert.deepEqual(sequence.issueNumbers, ["1", "2"]);
			assert.equal(sequence.after, "audio-seam-work");
			assert.equal(sequence.notes, "order matters");

			const moved = parseArgs([
				"queue",
				"sequence",
				"--name",
				"U2",
				"--issues",
				"1,2",
				"--before",
				"V",
			]);
			assert.equal(moved.before, "V");

			const dropped = parseArgs(["queue", "sequence", "--name", "N2", "--delete"]);
			assert.equal(dropped.queueDelete, true);
			assert.deepEqual(dropped.issueNumbers, []);

			const rule = parseArgs([
				"queue",
				"rule",
				"--name",
				"R1",
				"--issues",
				"1,2",
				"--reason",
				"same file",
			]);
			assert.equal(rule.queueSubcommand, "rule");
			assert.equal(rule.reason, "same file");

			const remove = parseArgs(["queue", "remove", "--issue", "8"]);
			assert.equal(remove.queueSubcommand, "remove");

			const list = parseArgs(["queue", "list", "--json"]);
			assert.equal(list.queueSubcommand, "list");
			assert.equal(list.jsonOut, true);
		});

		test("parseArgs parses the queue graph flags and keeps them off every other subcommand", () => {
			const graph = parseArgs(["queue", "graph", "--format", "ascii", "--expand-issues"]);
			assert.equal(graph.queueSubcommand, "graph");
			assert.equal(graph.queueFormat, "ascii");
			assert.equal(graph.queueExpandIssues, true);
			assert.equal(parseArgs(["queue", "graph", "--comment", "412"]).queueComment, "412");
			assert.equal(
				parseArgs(["queue", "graph", "--write", "docs/queue.md"]).queueWrite,
				"docs/queue.md",
			);
			/* `--json` is the machine channel for the same payload. */
			assert.equal(parseArgs(["queue", "graph", "--json"]).jsonOut, true);

			assert.throws(
				() => parseArgs(["queue", "graph", "--format", "svg"]),
				/--format must be one of: ascii, json, mermaid/u,
			);
			assert.throws(
				() => parseArgs(["queue", "graph", "--comment", "all"]),
				/--comment requires a GitHub issue number/u,
			);
			assert.throws(
				() => parseArgs(["queue", "list", "--expand-issues"]),
				/use them with `queue graph`/u,
			);
			assert.throws(
				() => parseArgs(["queue", "check", "--write", "docs/queue.md"]),
				/use them with `queue graph`/u,
			);
			assert.throws(
				() => parseArgs(["queue", "graph", "--write", "docs/queue.md", "--format", "json"]),
				/--write and --comment publish the Markdown rendering/u,
			);
		});

		test("parseArgs enforces queue subcommand and flag rules", () => {
			assert.throws(() => parseArgs(["queue"]), /queue requires a subcommand/);
			assert.throws(() => parseArgs(["queue", "bogus"]), /Unknown queue subcommand/);
			assert.throws(
				() => parseArgs(["queue", "add", "--issue", "5"]),
				/requires a placement/,
			);
			assert.throws(
				() => parseArgs(["queue", "add", "--sequence", "U2"]),
				/requires --issue <number>/,
			);
			assert.throws(
				() => parseArgs(["queue", "add", "--issue", "5", "--gated"]),
				/requires --reason <text>/,
			);
			assert.throws(
				() =>
					parseArgs([
						"queue",
						"add",
						"--issue",
						"5",
						"--gated",
						"--reason",
						"x",
						"--after",
						"4",
					]),
				/--after requires --sequence/,
			);
			assert.throws(
				() =>
					parseArgs([
						"queue",
						"add",
						"--issue",
						"5",
						"--sequence",
						"U2",
						"--before",
						"V",
					]),
				/describe a batch/,
			);
			assert.throws(
				() => parseArgs(["queue", "list", "--delete"]),
				/--delete removes a batch/,
			);
			assert.throws(
				() => parseArgs(["queue", "sequence", "--name", "U2", "--issues", "1", "--before"]),
				/--before requires a batch name/,
			);
			assert.equal(
				parseArgs(["queue", "sequence", "--name", "U2", "--issues", "1", "--last"]).last,
				true,
			);
			assert.throws(
				() =>
					parseArgs([
						"queue",
						"sequence",
						"--name",
						"U2",
						"--issues",
						"1",
						"--last",
						"--before",
						"V",
					]),
				/choose one/,
			);
			assert.throws(
				() => parseArgs(["queue", "sequence", "--name", "U2", "--last", "--delete"]),
				/--last does not apply/,
			);

			assert.throws(
				() => parseArgs(["queue", "add", "--issue", "5", "--gated", "--human"]),
				/either --gated or --human/,
			);
			assert.throws(
				() => parseArgs(["queue", "sequence", "--issues", "1,2"]),
				/requires --name <batch>/,
			);
			assert.throws(
				() => parseArgs(["queue", "rule", "--reason", "x"]),
				/queue rule requires/,
			);
			assert.throws(() => parseArgs(["queue", "remove"]), /queue remove requires --issue/);
		});

		test("parseArgs parses queue run, budget, and bypass flags", () => {
			const run = parseArgs([
				"queue",
				"run",
				"--name",
				"U2",
				"--max-issues",
				"3",
				"--keep-entries",
				"--strict-gates",
			]);
			assert.equal(run.queueSubcommand, "run");
			assert.equal(run.integrationName, "U2");
			assert.equal(run.maxIssues, 3);
			assert.equal(run.queueKeepEntries, true);
			assert.equal(run.queueStrictGates, true);

			assert.equal(parseArgs(["queue", "list", "--no-queue"]).queueEnabled, false);
			assert.equal(parseArgs(["queue", "list", "--queue"]).queueEnabled, true);
			assert.equal(parseArgs(["queue", "list", "--queue-commit"]).queueCommit, true);
			assert.equal(parseArgs(["queue", "bootstrap", "--apply"]).queueApply, true);

			assert.throws(
				() => parseArgs(["queue", "run", "--gated"]),
				/queue run does not accept/u,
			);
			assert.throws(
				() => parseArgs(["queue", "run", "--max-issues", "0"]),
				/positive integer/u,
			);
		});
	});
});

test("printHelp prints usage without throwing", () => {
	printHelp();
});

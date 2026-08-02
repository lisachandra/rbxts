/* oxlint-disable typescript/no-unnecessary-condition -- Tests intentionally inspect optional persisted state fields */
/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	abortIntegration,
	assertIntegrationName,
	checkoutBranch,
	cleanupIntegration,
	commaSeparated,
	commitExists,
	countNewCommits,
	createAgent,
	createIntegrationManifest,
	diracAgent,
	evaluateDesign,
	evaluateImplement,
	evaluatePhases,
	evaluateReview,
	fetchIssueLabels,
	getLatestReviewMarker,
	integrateManifestSource,
	integrationBranch,
	io,
	isIssueBlocked,
	isIssueComplete,
	isRateLimitError,
	main,
	normalizedPath,
	parseArgs,
	printHelp,
	printIntegrationStatus,
	readIntegrationManifest,
	readState,
	registeredWorktrees,
	resolveCommit,
	resolveExistingIntegrationSource,
	resolveIssueIntegrationSource,
	resumeIntegration,
	runAll,
	runNewIntegration,
	runPhaseWithRetry,
	runSequentialIssues,
	runSingleIssue,
	skillsForPrompt,
	uniqueSkills,
	updatePhase,
	writeIntegrationManifest,
	writeState,
} from "./main.js";
import { loadConfig } from "./config.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = join(repositoryRoot, ".tmp", "sandcastle-tests");
const plansDir = join(repositoryRoot, ".sandcastle", "plans");
const stateDir = join(repositoryRoot, ".sandcastle", "state");
const integrationsDir = join(repositoryRoot, ".sandcastle", "integrations");

const originalIo = {
	execFileSync: io.execFileSync,
	execSync: io.execSync,
	exit: io.exit,
	pi: io.pi,
	run: io.run,
	sleep: io.sleep,
};

const originalArgv = [...process.argv];
const originalEnv = { ...process.env };

class ExitError extends Error {
	public readonly code: number;

	constructor(code: number) {
		super(`exit ${code}`);
		this.code = code;
	}
}

function restoreIo(): void {
	io.execFileSync = originalIo.execFileSync;
	io.execSync = originalIo.execSync;
	io.exit = originalIo.exit;
	io.pi = originalIo.pi;
	io.run = originalIo.run;
	io.sleep = originalIo.sleep;
}

function stubExit(): Array<number> {
	const codes: Array<number> = [];
	io.exit = (code: number) => {
		codes.push(code);
		throw new ExitError(code);
	};

	return codes;
}

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
	const keys = Object.keys(overrides);
	const previous = new Map(keys.map((key) => [key, process.env[key]]));
	try {
		for (const [key, value] of Object.entries(overrides)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}

		run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

function uniqueIssue(prefix = "9"): string {
	return `${prefix}${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)
		.toString()
		.padStart(2, "0")}`;
}

function cleanupIssueArtifacts(issue: string): void {
	for (const path of [join(plansDir, `${issue}.md`), join(stateDir, `${issue}.json`)]) {
		if (existsSync(path)) {
			rmSync(path, { force: true });
		}
	}
}

function writePlan(issue: string, content: string): string {
	mkdirSync(plansDir, { recursive: true });
	const path = join(plansDir, `${issue}.md`);
	writeFileSync(path, content, "utf-8");
	return path;
}

type PhaseStatus = "done" | "failed" | "skipped";

function makeState(
	issue: string,
	overrides: Partial<{
		commits: Array<string>;
		design: PhaseStatus;
		implement: PhaseStatus;
		model: string;
		review: PhaseStatus;
	}> = {},
) {
	return {
		branch: `sandcastle/issue-${issue}`,
		effort: "xhigh",
		issue,
		model: overrides.model ?? "test-model",
		phases: {
			design: {
				status: overrides.design ?? "skipped",
				timestamp: "2026-01-01T00:00:00.000Z",
			},
			implement: {
				extra: overrides.commits ? { commits: overrides.commits } : undefined,
				status: overrides.implement ?? "skipped",
				timestamp: "2026-01-01T00:00:00.000Z",
			},
			review: {
				status: overrides.review ?? "skipped",
				timestamp: "2026-01-01T00:00:00.000Z",
			},
		},
	} as const;
}

function stubExecSync(result: string): void {
	io.execSync = (() => result) as unknown as typeof io.execSync;
}

function stubRun(result: Record<string, unknown>): void {
	io.run = (async () => result) as unknown as typeof io.run;
}

function gitStub(handlers: {
	file?: (args: ReadonlyArray<string>, cwd?: string) => string | undefined;
	sync?: (command: string, cwd?: string) => string | undefined;
}): void {
	io.execFileSync = ((
		command: string,
		args?: string | ReadonlyArray<string>,
		options?: { cwd?: string },
	) => {
		if (command !== "git") {
			throw new Error(`unexpected execFileSync command: ${command}`);
		}

		const argv = Array.isArray(args) ? args.map(String) : [];
		const result = handlers.file?.(argv, options?.cwd);
		if (result === undefined) {
			throw new Error(`unhandled git ${argv.join(" ")}`);
		}

		return result;
	}) as typeof io.execFileSync;

	io.execSync = ((command: string, options?: { cwd?: string }) => {
		const result = handlers.sync?.(String(command), options?.cwd);
		if (result === undefined) {
			throw new Error(`unhandled execSync: ${command}`);
		}

		return result;
	}) as typeof io.execSync;
}

beforeEach(() => {
	mkdirSync(tmpRoot, { recursive: true });
	restoreIo();
	process.argv = [...originalArgv];
});

afterEach(() => {
	restoreIo();
	process.argv = [...originalArgv];
	for (const [key, value] of Object.entries(originalEnv)) {
		process.env[key] = value;
	}

	for (const key of Object.keys(process.env)) {
		if (!(key in originalEnv)) {
			delete process.env[key];
		}
	}
});

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
					"--max-iterations",
					"12",
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
				assert.equal(options.maxImplementIterations, 12);
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
			assert.throws(() => parseArgs(["--issue", "1", "--agent", "nope"]), /dirac, pi/);
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

describe("config loading", () => {
	test("loadConfig uses defaults when no config file exists", () => {
		const dir = join(tmpRoot, "config-defaults");
		mkdirSync(dir, { recursive: true });
		const config = loadConfig(dir);
		assert.equal(config.dir, ".sandcastle");
		assert.equal(config.baseBranch, "main");
		assert.equal(config.effort, "xhigh");
		assert.equal(config.agents.default, "dirac");
		assert.deepEqual(config.agents.models, {});
		assert.equal(config.prompts.plan.endsWith("plan-prompt.md"), true);
	});

	test("loadConfig merges repo config over defaults", () => {
		const dir = join(tmpRoot, "config-override");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "sandcastle.config.ts"),
			[
				"const config = {",
				'	effort: "max",',
				'	agents: { default: "pi", models: { dirac: "model-a", pi: "model-b" } },',
				"};",
				"export default config;",
			].join("\n"),
			"utf-8",
		);
		const config = loadConfig(dir);
		assert.equal(config.effort, "max");
		assert.equal(config.agents.default, "pi");
		assert.equal(config.agents.models.dirac, "model-a");
		assert.equal(config.agents.models.pi, "model-b");
		assert.equal(config.baseBranch, "main");
	});
});

describe("phase evaluation", () => {
	test("evaluateDesign handles missing, empty, malformed, and valid plans", () => {
		const issue = uniqueIssue();
		const planFile = join(plansDir, `${issue}.md`);
		const worktree = join(tmpRoot, `wt-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(evaluateDesign(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /does not exist/);

		writePlan(issue, "   ");
		assert.equal(evaluateDesign(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /empty/);

		writePlan(issue, "no headings here");
		assert.equal(evaluateDesign(undefined, planFile, worktree, reasons), "start");
		assert.match(reasons.design, /no headings/);

		writePlan(issue, "# Plan\n\nDo the thing.");
		assert.equal(evaluateDesign(undefined, planFile, worktree, reasons), "skip");
		assert.match(reasons.design, /missing or incomplete/);

		const state = makeState(issue, { design: "done" });
		assert.equal(evaluateDesign(state, planFile, worktree, reasons), "skip");
		assert.match(reasons.design, /marked done/);

		cleanupIssueArtifacts(issue);
	});

	test("evaluateImplement covers plan/worktree/commits/model/fail paths", () => {
		const issue = uniqueIssue();
		const planFile = join(plansDir, `${issue}.md`);
		const worktree = join(tmpRoot, `wt-impl-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(
			evaluateImplement(undefined, "m", planFile, worktree, issue, "main", reasons),
			"skip",
		);

		writePlan(issue, "# Plan");
		assert.equal(
			evaluateImplement(undefined, "m", planFile, worktree, issue, "main", reasons),
			"start",
		);
		assert.match(reasons.implement, /worktree does not exist/);

		mkdirSync(worktree, { recursive: true });
		io.execSync = () => {
			throw new Error("git failed");
		};

		assert.equal(
			evaluateImplement(undefined, "m", planFile, worktree, issue, "main", reasons),
			"start",
		);
		assert.match(reasons.implement, /no new commits/);

		stubExecSync("2");
		assert.equal(
			evaluateImplement(undefined, "m", planFile, worktree, issue, "main", reasons),
			"start",
		);
		assert.match(reasons.implement, /no state record/);

		const done = makeState(issue, { implement: "done", model: "old" });
		assert.equal(
			evaluateImplement(done, "new", planFile, worktree, issue, "main", reasons),
			"start",
		);
		assert.match(reasons.implement, /model changed/);

		const same = makeState(issue, { implement: "done", model: "same" });
		assert.equal(
			evaluateImplement(same, "same", planFile, worktree, issue, "main", reasons),
			"skip",
		);

		const failed = makeState(issue, { implement: "failed" });
		assert.equal(
			evaluateImplement(failed, "m", planFile, worktree, issue, "main", reasons),
			"start",
		);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("evaluateReview covers blocked, stale commits, done, and needed", () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `wt-review-${issue}`);
		const reasons = { design: "", implement: "", review: "" };

		assert.equal(evaluateReview(undefined, issue, "main", worktree, reasons), "skip");

		mkdirSync(worktree, { recursive: true });
		stubExecSync("1");
		assert.equal(evaluateReview(undefined, issue, "main", worktree, reasons), "start");

		const implementDone = makeState(issue, { implement: "done" });
		assert.equal(evaluateReview(implementDone, issue, "main", worktree, reasons), "start");

		const reviewDone = makeState(issue, { implement: "done", review: "done" });
		assert.equal(evaluateReview(reviewDone, issue, "main", worktree, reasons), "skip");

		rmSync(worktree, { force: true, recursive: true });
	});

	test("evaluatePhases supports phase isolation and force overrides", () => {
		const issue = uniqueIssue();
		writePlan(issue, "# Plan");
		stubExecSync("0");

		const isolated = evaluatePhases(issue, "m", {
			force: "implement",
			phase: "implement",
			resume: true,
		});
		assert.equal(isolated.design, "skip");
		assert.equal(isolated.implement, "force");
		assert.equal(isolated.review, "skip");

		const forcedAll = evaluatePhases(issue, "m", { force: true, resume: false });
		assert.equal(forcedAll.design, "force");
		assert.equal(forcedAll.implement, "force");
		assert.equal(forcedAll.review, "force");

		const forcedOne = evaluatePhases(issue, "m", { force: "review", resume: false });
		assert.equal(forcedOne.review, "force");

		cleanupIssueArtifacts(issue);
	});
});

describe("rate limit, skills, markers, helpers", () => {
	test("isRateLimitError matches known phrases", () => {
		assert.equal(isRateLimitError("HTTP 429"), true);
		assert.equal(isRateLimitError("rate_limit exceeded"), true);
		assert.equal(isRateLimitError("Rate Limit"), true);
		assert.equal(isRateLimitError("Too Many Requests"), true);
		assert.equal(isRateLimitError("quota exceeded"), true);
		assert.equal(isRateLimitError("resource_exhausted"), true);
		assert.equal(isRateLimitError("boom"), false);
	});

	test("runPhaseWithRetry retries rate limits and rethrows other errors", async () => {
		const sleeps: Array<number> = [];
		io.sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		let attempts = 0;
		const result = await runPhaseWithRetry(async () => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error("429 rate limit");
			}

			return { commits: [{ sha: "abc" }], stdout: "ok" };
		}, "design");
		assert.equal(result.stdout, "ok");
		assert.equal(attempts, 3);
		assert.deepEqual(sleeps, [30_000, 60_000]);

		await assert.rejects(
			async () =>
				runPhaseWithRetry(async () => {
					throw new Error("fatal");
				}, "implement"),
			/fatal/,
		);

		await assert.rejects(
			async () =>
				runPhaseWithRetry(
					async () => {
						throw new Error("quota exceeded");
					},
					"review",
					2,
				),
			/quota exceeded/,
		);
	});

	test("skillsForPrompt includes label-specific skills and uniqueSkills dedupes", () => {
		assert.deepEqual(uniqueSkills(["a", "b", "a"]), ["a", "b"]);
		const design = skillsForPrompt("design", ["ecs", "security", "ui"]);
		assert.match(design, /domain-modeling/);
		assert.match(design, /threat-model/);
		assert.match(design, /react-roblox-ui/);
		assert.equal(design.split("\n").length, new Set(design.split("\n")).size);
	});

	test("assertIntegrationName and integrationBranch", () => {
		assert.doesNotThrow(() => {
			assertIntegrationName("wave-1");
		});
		assert.throws(() => {
			assertIntegrationName("../evil");
		}, /Invalid integration name/);
		assert.equal(integrationBranch("wave-1"), "sandcastle/integration/wave-1");
	});

	test("isIssueComplete and review markers", () => {
		const issue = uniqueIssue();
		assert.equal(isIssueComplete(issue), false);

		writeState(
			makeState(issue, {
				commits: ["abc"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);
		assert.equal(isIssueComplete(issue), true);

		stubExecSync(
			JSON.stringify({
				comments: [
					{ body: "Sandcastle-Review: BLOCKED" },
					{ body: "noise" },
					{ body: "Sandcastle-Review: APPROVED" },
				],
			}),
		);
		assert.equal(getLatestReviewMarker(issue), "APPROVED");
		assert.equal(isIssueBlocked(issue), false);

		stubExecSync(
			JSON.stringify({
				comments: [{ body: "Sandcastle-Review: BLOCKED" }],
			}),
		);
		assert.equal(isIssueBlocked(issue), true);

		cleanupIssueArtifacts(issue);
	});

	test("fetchIssueLabels returns [] on failure and parses labels", () => {
		io.execSync = () => {
			throw new Error("gh down");
		};

		assert.deepEqual(fetchIssueLabels("1"), []);

		stubExecSync(JSON.stringify({ labels: [{ name: "ecs" }, { name: "" }, {}] }));
		assert.deepEqual(fetchIssueLabels("1"), ["ecs"]);
	});

	test("countNewCommits returns 0 on failure", () => {
		io.execSync = () => {
			throw new Error("bad");
		};

		assert.equal(countNewCommits(tmpRoot, "main"), 0);

		stubExecSync("4");
		assert.equal(countNewCommits(tmpRoot, "main"), 4);
	});

	test("normalizedPath and printHelp", () => {
		const path = normalizedPath(tmpRoot);
		assert.equal(path.includes("sandcastle-tests"), true);
		printHelp();
	});
});

describe("agents", () => {
	test("diracAgent buildPrintCommand and parseStreamLine", () => {
		const agent = diracAgent("gpt", {
			completionSignal: "<promise>DONE</promise>",
			effort: "high",
			env: { OPENAI_API_KEY: "k" },
		});
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
		});
		assert.match(command.command, /dirac-wrapper\.sh/);
		assert.match(command.command, /-y/);
		assert.match(command.command, /--reasoning-effort high/);
		assert.equal(command.stdin, "hi");

		assert.deepEqual(agent.parseStreamLine("not-json"), []);
		assert.deepEqual(agent.parseStreamLine(JSON.stringify({ type: "task_started" })), []);

		const userEvents = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "markdown",
					content: "user prompt with <promise>DONE</promise>",
					isReasoning: false,
					role: "user",
				},
			}),
		);
		assert.deepEqual(userEvents, []);

		const assistantEvents = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "markdown",
					content: "partial",
					isReasoning: false,
					role: "assistant",
				},
			}),
		);
		assert.deepEqual(assistantEvents, [{ type: "text", text: "partial" }]);

		const signalEvents = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "markdown",
					content: "done <promise>DONE</promise>",
					isReasoning: false,
					role: "assistant",
				},
			}),
		);
		assert.equal(
			signalEvents.some((event) => event.type === "result"),
			true,
		);

		const cardAfterSignal = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "card",
					card: { body: "card body" },
				},
			}),
		);
		assert.deepEqual(cardAfterSignal, []);

		const usage = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "api_status",
					status: {
						cacheReads: 1,
						cacheWrites: 2,
						tokensIn: 3,
						tokensOut: 4,
					},
				},
			}),
		);
		assert.deepEqual(usage, [
			{
				type: "usage",
				usage: {
					cacheCreationInputTokens: 2,
					cacheReadInputTokens: 1,
					inputTokens: 3,
					outputTokens: 4,
				},
			},
		]);
	});

	test("diracAgent emits card results before completion signal", () => {
		const agent = diracAgent("gpt", { completionSignal: "SIG" });
		agent.parseStreamLine(JSON.stringify({ type: "task_started" }));
		const card = agent.parseStreamLine(
			JSON.stringify({
				content: {
					type: "card",
					card: { body: "plan body" },
				},
			}),
		);
		assert.deepEqual(card, [{ type: "result", result: "plan body" }]);
	});

	test("createAgent selects supported backends", () => {
		io.pi = ((model: string) => ({ name: `pi:${model}` })) as typeof io.pi;
		assert.equal((createAgent("pi", "m", "low") as { name: string }).name, "pi:m");
		assert.equal(createAgent("dirac", "m", "low", "SIG").name, "dirac");
	});
});

describe("state and integration I/O", () => {
	test("readState handles missing and invalid JSON; updatePhase writes", () => {
		const issue = uniqueIssue();
		assert.equal(readState(issue), undefined);

		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, `${issue}.json`), "{not-json", "utf-8");
		assert.equal(readState(issue), undefined);

		const state = makeState(issue);
		writeState(state);
		updatePhase(state, "design", "done", { note: true });
		const loaded = readState(issue);
		assert.equal(loaded?.phases.design.status, "done");
		assert.equal((loaded?.phases.design.extra as { note?: boolean })?.note, true);

		cleanupIssueArtifacts(issue);
	});

	test("integration manifest invalid JSON throws; abort/status/cleanup paths", () => {
		const name = `test-int-${Date.now()}`;
		const dir = join(integrationsDir, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "manifest.json"), "{bad", "utf-8");
		assert.throws(() => readIntegrationManifest(name), /invalid/);

		const manifest = {
			base: { commit: "abc1234", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
			name,
			sources: [
				{
					branch: "sandcastle/issue-1",
					commit: "def5678",
					issue: "1",
					name: "issue-1",
					order: 1,
				},
			],
			status: "created" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);
		assert.equal(readIntegrationManifest(name)?.name, name);

		printIntegrationStatus(name);
		abortIntegration(name);
		assert.equal(readIntegrationManifest(name)?.status, "aborted");

		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		gitStub({
			file: (args) => {
				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				if (args[0] === "status" && args[1] === "--porcelain") {
					return " M file";
				}

				if (args[0] === "worktree" && args[1] === "remove") {
					return "";
				}

				if (args[0] === "status" && args[1] === "--short") {
					return " M file";
				}

				return "";
			},
		});
		assert.throws(() => {
			cleanupIntegration(name, false);
		}, /dirty or has an active merge/);
		cleanupIntegration(name, true);
		assert.equal(readIntegrationManifest(name)?.status, "aborted");

		rmSync(dir, { force: true, recursive: true });
	});

	test("resolveIssueIntegrationSource gates review completion", () => {
		const issue = uniqueIssue();
		assert.throws(() => resolveIssueIntegrationSource("abc", false), /Invalid issue number/);
		assert.throws(
			() => resolveIssueIntegrationSource(issue, false),
			/review phase is not complete/,
		);

		writeState(makeState(issue, { review: "done" }));
		stubExecSync(
			JSON.stringify({
				comments: [{ body: "Sandcastle-Review: BLOCKED" }],
			}),
		);
		assert.throws(() => resolveIssueIntegrationSource(issue, false), /expected APPROVED/);

		stubExecSync(
			JSON.stringify({
				comments: [{ body: "Sandcastle-Review: APPROVED" }],
			}),
		);
		gitStub({
			file: (args) => {
				if (args[0] === "rev-parse") {
					return "abcdef1234567";
				}

				return "";
			},
			sync: () => JSON.stringify({ comments: [{ body: "Sandcastle-Review: APPROVED" }] }),
		});
		const source = resolveIssueIntegrationSource(issue, false);
		assert.equal(source.issue, issue);
		assert.equal(source.commit, "abcdef1234567");

		const unreviewed = resolveIssueIntegrationSource(issue, true);
		assert.equal(unreviewed.issue, issue);

		cleanupIssueArtifacts(issue);
	});

	test("resolveExistingIntegrationSource validates status and commits", () => {
		const name = `compose-${Date.now()}`;
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			headCommit: "2222222",
			kind: "integrations" as const,
			name,
			sources: [],
			status: "created" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);
		assert.throws(() => resolveExistingIntegrationSource(name, false), /status is created/);

		writeIntegrationManifest({ ...manifest, status: "ready-for-human-merge" });
		gitStub({
			file: (args) => {
				if (args[0] === "cat-file") {
					return "";
				}

				if (args[0] === "rev-parse") {
					return "2222222";
				}

				return "";
			},
		});
		const source = resolveExistingIntegrationSource(name, false);
		assert.equal(source.commit, "2222222");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});
});

describe("git helpers with stubs", () => {
	test("resolveCommit, commitExists, registeredWorktrees, checkoutBranch", () => {
		gitStub({
			file: (args) => {
				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "0123456789abcdef";
				}

				if (args[0] === "cat-file") {
					return "";
				}

				if (args[0] === "worktree" && args[1] === "list") {
					return [
						"worktree /tmp/a",
						"branch refs/heads/feature",
						"",
						"worktree /tmp/b",
						"",
					].join("\n");
				}

				if (args[0] === "-C" && args[2] === "rev-parse") {
					return ".git";
				}

				if (args[0] === "-C" && args[2] === "symbolic-ref") {
					return "feature";
				}

				return "";
			},
		});

		assert.equal(resolveCommit("HEAD"), "0123456789abcdef");
		assert.equal(commitExists("0123456789abcdef"), true);
		assert.deepEqual(registeredWorktrees(), [
			{ branch: "feature", path: "/tmp/a" },
			{ branch: undefined, path: "/tmp/b" },
		]);

		const branchPath = join(tmpRoot, "checkout-branch");
		mkdirSync(branchPath, { recursive: true });
		assert.equal(checkoutBranch(branchPath), "feature");
		assert.equal(checkoutBranch(join(tmpRoot, "missing-path")), undefined);
		rmSync(branchPath, { force: true, recursive: true });
	});

	test("resolveCommit rejects non-hex output", () => {
		gitStub({
			file: () => "not-a-commit",
		});
		assert.throws(() => resolveCommit("HEAD"), /did not resolve to a commit/);
	});
});

describe("main routing", () => {
	test("help and dry-run exit 0", async () => {
		const codes = stubExit();
		process.argv = ["node", "main.ts", "--help"];
		await assert.rejects(
			async () => main(),
			(err: unknown) => err instanceof ExitError && err.code === 0,
		);
		assert.deepEqual(codes, [0]);

		process.argv = ["node", "main.ts", "--issue", "1", "--dry-run", "--model", "m"];
		await assert.rejects(
			async () => main(),
			(err: unknown) => err instanceof ExitError && err.code === 0,
		);
	});

	test("missing issue number throws after help", async () => {
		process.env["DIRAC_SANDCASTLE_MODEL"] = "m";
		process.argv = ["node", "main.ts"];
		await assert.rejects(async () => main(), /issue number/);
	});

	test("integration-status requires name", async () => {
		process.env["DIRAC_SANDCASTLE_MODEL"] = "m";
		process.argv = ["node", "main.ts", "integration-status"];
		await assert.rejects(async () => main(), /--name is required/);
	});

	test("issue-sequence requires --sequential", async () => {
		process.env["DIRAC_SANDCASTLE_MODEL"] = "m";
		process.argv = ["node", "main.ts", "issue-sequence"];
		await assert.rejects(async () => main(), /--sequential is required/);
	});
});

describe("orchestration with heavy stubs", () => {
	test("runSingleIssue fresh run completes design/implement/review with supplied worktree", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `run-single-${issue}`);
		mkdirSync(worktree, { recursive: true });
		writePlan(issue, "# Plan\n");

		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [{ name: "ecs" }] });
				}

				if (command.includes("gh issue view")) {
					return "Test issue title";
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				if (command.includes("fetch-places") || command.includes("pnpm setup")) {
					return "";
				}

				return "";
			},
		});

		stubRun({
			commits: [{ sha: "c1" }],
			stdout: "agent output",
		});

		await runSingleIssue(issue, "model", "low", 5, {
			agentBackend: "dirac",
			baseRef: "main",
			worktree,
		});

		const state = readState(issue);
		assert.equal(state?.phases.design.status, "done");
		assert.equal(state?.phases.implement.status, "done");
		assert.equal(state?.phases.review.status, "done");

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runSingleIssue records design failure on empty stdout", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `run-empty-${issue}`);
		mkdirSync(worktree, { recursive: true });

		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [] });
				}

				if (command.includes("gh issue view")) {
					return "title";
				}

				if (command.includes("rev-list")) {
					return "0";
				}

				return "";
			},
		});
		stubRun({ commits: [], stdout: "" });

		await runSingleIssue(issue, "model", "low", 5, {
			agentBackend: "dirac",
			worktree,
		});
		assert.equal(readState(issue)?.phases.design.status, "failed");

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runSingleIssue resume with all skip does not run setup", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `run-skip-${issue}`);
		mkdirSync(worktree, { recursive: true });
		writePlan(issue, "# Plan");
		writeState(
			makeState(issue, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);

		let setupCalls = 0;
		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("fetch-places") || command.includes("pnpm setup")) {
					setupCalls += 1;
					return "";
				}

				if (command.includes("rev-list")) {
					return "2";
				}

				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [] });
				}

				if (command.includes("gh issue view")) {
					return "title";
				}

				return "";
			},
		});

		await runSingleIssue(issue, "test-model", "low", 5, {
			agentBackend: "dirac",
			resume: true,
			worktree,
		});
		assert.equal(setupCalls, 0);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runAll handles empty plan and concurrent failures", async () => {
		stubRun({
			output: { issues: [] },
		});
		await runAll("m", "dirac", "low", 5, 1);

		stubRun({
			output: {
				issues: [
					{ branch: "b1", id: uniqueIssue("8"), title: "one" },
					{ branch: "b2", id: uniqueIssue("8"), title: "two" },
				],
			},
		});

		const originalRunSingle = runSingleIssue;
		// Force failures by making validate worktree fail through missing git stubs.
		gitStub({
			file: () => {
				throw new Error("no git");
			},
			sync: () => {
				throw new Error("no sync");
			},
		});
		await runAll("m", "dirac", "low", 5, 2);
		void originalRunSingle;
	});

	test("runSequentialIssues empty throws; blocked and failed exit", async () => {
		await assert.rejects(
			async () => runSequentialIssues([], "main", "m", "low", 1, "dirac", false),
			/At least one/,
		);

		const issue = uniqueIssue();
		// Resume-skip checks the default sandcastle worktree path when no --worktree is supplied.
		const worktree = join(
			repositoryRoot,
			".sandcastle",
			"worktrees",
			`sandcastle-issue-${issue}`,
		);
		mkdirSync(worktree, { recursive: true });
		writePlan(issue, "# Plan");
		writeState(
			makeState(issue, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);

		const codes = stubExit();
		gitStub({
			file: (args) => {
				if (args[0] === "show-ref") {
					return "";
				}

				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: APPROVED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [] });
				}

				if (command.includes("gh issue view")) {
					return "title";
				}

				return "";
			},
		});

		// Resume skip path for completed issue, then no blocked/failed.
		await runSequentialIssues([issue], "main", "test-model", "low", 1, "dirac", true);
		assert.deepEqual(codes, []);

		// Failed path.
		const failingIssue = uniqueIssue();
		gitStub({
			file: () => {
				throw new Error("boom");
			},
			sync: () => {
				throw new Error("boom");
			},
		});
		await assert.rejects(
			async () => runSequentialIssues([failingIssue], "main", "m", "low", 1, "dirac", false),
			(err: unknown) => err instanceof ExitError && err.code === 1,
		);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runSequentialIssues aborts on blocked review", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `seq-block-${issue}`);
		mkdirSync(worktree, { recursive: true });
		writePlan(issue, "# Plan");

		const codes = stubExit();
		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: BLOCKED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [] });
				}

				if (command.includes("gh issue view")) {
					return "title";
				}

				return "";
			},
		});
		stubRun({
			commits: [{ sha: "c1" }],
			stdout: "ok",
		});

		await assert.rejects(
			async () =>
				runSequentialIssues([issue], "main", "model", "low", 5, "dirac", false, worktree),
			(err: unknown) => err instanceof ExitError && err.code === 1,
		);
		assert.equal(codes.at(-1), 1);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});
});

describe("integration composition", () => {
	test("createIntegrationManifest preflight failure records status", () => {
		const name = `preflight-${Date.now()}`;
		gitStub({
			file: (args) => {
				if (args[0] === "rev-parse") {
					return "abc1234";
				}

				if (args[0] === "show-ref") {
					throw new Error("missing");
				}

				if (args[0] === "worktree") {
					throw new Error("cannot add worktree");
				}

				return "";
			},
		});

		assert.throws(
			() =>
				createIntegrationManifest(
					name,
					"issues",
					"main",
					[
						{
							branch: "sandcastle/issue-1",
							commit: "def5678",
							issue: "1",
							name: "issue-1",
							order: 1,
						},
					],
					true,
				),
			/cannot add worktree/,
		);
		assert.equal(readIntegrationManifest(name)?.status, "preflight-failed");
		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("integrateManifestSource short-circuits when already ancestor", async () => {
		const name = `ancestor-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
			name,
			sources: [
				{
					branch: "sandcastle/issue-1",
					commit: "2222222",
					issue: "1",
					name: "issue-1",
					order: 1,
				},
			],
			status: "merging" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);

		gitStub({
			file: (args) => {
				if (args[0] === "merge-base") {
					return "";
				}

				return "";
			},
		});

		const source = manifest.sources[0];
		assert.ok(source);
		await integrateManifestSource(manifest, source, worktree, "m", "low", "dirac");

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("integrateManifestSource resolves merge conflicts via agent", async () => {
		const name = `conflict-${Date.now()}`;
		const worktree = join(integrationsDir, name, "worktree");
		mkdirSync(worktree, { recursive: true });
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
			name,
			sources: [
				{
					branch: "sandcastle/issue-1",
					commit: "2222222",
					issue: "1",
					name: "issue-1",
					order: 1,
				},
			],
			status: "merging" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);

		let mergeAttempts = 0;
		let resolverRan = false;
		gitStub({
			file: (args) => {
				if (args[0] === "merge-base") {
					throw new Error("not ancestor");
				}

				if (args[0] === "rev-parse" && args[1] === "--git-dir") {
					return ".git";
				}

				if (args[0] === "diff") {
					/*
					 * After merge fails, report unmerged paths so the conflict path is taken.
					 * After the resolver runs, report clean.
					 */
					return resolverRan ? "" : mergeAttempts > 0 ? "conflicted.ts" : "";
				}

				if (args[0] === "merge") {
					mergeAttempts += 1;
					throw new Error("conflict");
				}

				if (args[0] === "commit") {
					return "";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
		});
		io.run = (async () => {
			resolverRan = true;
			return { commits: [], stdout: "resolved" };
		}) as unknown as typeof io.run;

		// MERGE_HEAD should not exist so merge path is taken.
		const source = manifest.sources[0];
		assert.ok(source);
		await integrateManifestSource(manifest, source, worktree, "m", "low", "dirac");
		assert.equal(readIntegrationManifest(name)?.status, "conflict-resolution-required");
		assert.equal(resolverRan, true);

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("resumeIntegration rejects terminal statuses and runNewIntegration validates sources", async () => {
		const name = `resume-${Date.now()}`;
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
			name,
			sources: [],
			status: "ready-for-human-merge" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);
		await assert.rejects(
			async () => resumeIntegration(name, "m", "low", "dirac"),
			/cannot be resumed/,
		);

		await assert.rejects(
			async () => runNewIntegration("issues", "x", [], "main", true, "m", "low", "dirac"),
			/At least one integration source/,
		);

		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});

	test("main dispatches integration-abort", async () => {
		const name = `abort-main-${Date.now()}`;
		const manifest = {
			base: { commit: "1111111", ref: "main" },
			branch: integrationBranch(name),
			createdAt: new Date().toISOString(),
			kind: "issues" as const,
			name,
			sources: [],
			status: "created" as const,
			updatedAt: new Date().toISOString(),
			worktree: `.sandcastle/integrations/${name}/worktree`,
		};
		writeIntegrationManifest(manifest);
		process.env["DIRAC_SANDCASTLE_MODEL"] = "m";
		process.argv = ["node", "main.ts", "integration-abort", "--name", name];
		await main();
		assert.equal(readIntegrationManifest(name)?.status, "aborted");
		rmSync(join(integrationsDir, name), { force: true, recursive: true });
	});
});

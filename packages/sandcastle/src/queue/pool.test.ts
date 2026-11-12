import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

import { parseArgs } from "../cli.js";
import type { AgentProfile } from "../config.js";
import { config, io } from "../runtime.js";
import { ExitError, registerTestHooks, tmpRoot } from "../test-helpers.js";
import { queueLockPath, runLockName } from "./lock.js";
import { emptyQueueManifest, type QueueManifest, writeQueueManifest } from "./manifest.js";
import { laneArgs, type LaneSpawnParams, runParallelPool } from "./pool.js";
import { profileByName, profileForLane, resolveLaneAgents } from "./profile.js";

registerTestHooks();

const primary = join(tmpRoot, "pool-primary");
const relativeManifest = "sandcastle.queue.pool.json";
const manifestPath = join(primary, relativeManifest);

const flash: AgentProfile = {
	backend: "zcode",
	effort: "high",
	model: "flash-model",
	name: "flash",
};

const deep: AgentProfile = {
	backend: "dirac",
	effort: "max",
	model: "deep-model",
	name: "deep",
};

interface GhIssue {
	labels: Array<{ name: string }>;
	number: number;
	state: string;
	title: string;
}

function makeIssue(number: number): GhIssue {
	return {
		labels: [{ name: config.labels.readyForAgent }],
		number,
		state: "OPEN",
		title: `feat(queue): issue ${String(number)}`,
	};
}

/** Stubs the `gh` and `git` surfaces the pooled scheduler reads. */
function stubGh(issues: ReadonlyArray<GhIssue>): void {
	io.execSync = ((command: string) => {
		const text = String(command);
		if (text.startsWith("gh issue list")) {
			return JSON.stringify(issues);
		}

		if (text.startsWith("gh issue view")) {
			return JSON.stringify({ comments: [] });
		}

		if (text.startsWith("gh repo view")) {
			return "owner/repo";
		}

		throw new Error(`unexpected execSync: ${text}`);
	}) as typeof io.execSync;

	io.execFileSync = ((command: string, args?: string | ReadonlyArray<string>) => {
		const argv = Array.isArray(args) ? args.map(String) : [];
		if (command === "git" && argv[0] === "rev-parse") {
			return join(primary, ".git");
		}

		if (command === "gh" && argv[0] === "api") {
			const nodes = Object.fromEntries(
				issues.map((entry) => [
					`i${String(entry.number)}`,
					{ blockedBy: { nodes: [] }, number: entry.number, state: entry.state },
				]),
			);
			return JSON.stringify({ data: { repository: nodes } });
		}

		throw new Error(`unexpected execFileSync: ${command} ${argv.join(" ")}`);
	}) as typeof io.execFileSync;
}

/** Writes a manifest and stubs `gh`; returns the captured exit codes. */
function stage(
	sequences: QueueManifest["sequences"],
	live: ReadonlyArray<GhIssue>,
): { codes: Array<number> } {
	rmSync(manifestPath, { force: true });
	rmSync(queueLockPath(runLockName), { force: true });
	config.queue.file = relativeManifest;
	config.queue.commit = false;
	config.queue.lease = "off";
	writeQueueManifest({ ...emptyQueueManifest(), sequences }, manifestPath);
	stubGh(live);

	const codes: Array<number> = [];
	io.exit = (code: number): never => {
		codes.push(code);
		throw new ExitError(code);
	};

	return { codes };
}

/** Parses `queue run --parallel` argv against an explicit catalog. */
function options(
	catalog: Array<AgentProfile>,
	argv: ReadonlyArray<string>,
): ReturnType<typeof parseArgs> {
	config.agents.catalog = catalog;
	config.queue.parallel = 3;
	return parseArgs([...argv, "--model", "test-model"]);
}

/** Collects console output while a stub runs, so assertions can read the lane report. */
async function capture<T>(run: () => Promise<T>): Promise<{ output: string; value: T }> {
	const lines: Array<string> = [];
	const original = console.log;
	const originalError = console.error;
	console.log = ((...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	}) as typeof console.log;
	console.error = (...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	};

	try {
		/*
		 * Await before reading `lines`: an object literal evaluates its properties in order, so
		 * `output: lines.join()` beside `value: await run()` snapshots the output before the run has
		 * produced any.
		 */
		const value = await run();
		return { output: lines.join("\n"), value };
	} finally {
		console.log = original;
		console.error = originalError;
	}
}

describe("lane profiles", () => {
	test("lane N draws catalog[N % length]", () => {
		assert.equal(profileForLane([flash, deep], 0)?.name, "flash");
		assert.equal(profileForLane([flash, deep], 1)?.name, "deep");
		assert.equal(profileForLane([flash, deep], 2)?.name, "flash");
		assert.equal(profileForLane([flash, deep], 3)?.name, "deep");
	});

	test("an empty catalog yields no profile", () => {
		assert.equal(profileForLane([], 0), undefined);
	});

	test("profileByName ignores an absent name and rejects an unknown one", () => {
		assert.equal(profileByName([flash, deep], undefined), undefined);
		assert.equal(profileByName([flash, deep], ""), undefined);
		assert.equal(profileByName([flash, deep], "deep")?.name, "deep");
		assert.equal(profileByName([flash, deep], "nope"), undefined);
	});

	test("a profile replaces the workflow default and keeps its step overrides", () => {
		const lane = resolveLaneAgents(
			{
				...config,
				agents: {
					...config.agents,
					steps: { review: { effort: "low" } },
				},
			},
			{ ...flash, steps: { review: { effort: "medium" } } },
		);

		assert.equal(lane.agentBackend, "zcode");
		assert.equal(lane.model, "flash-model");
		assert.equal(lane.effort, "high");
		// The profile's own step override wins over the repository's.
		assert.equal(lane.steps.review.effort, "medium");
		assert.equal(lane.steps.design.effort, "high");
	});

	test("a CLI per-step flag still beats the profile", () => {
		const lane = resolveLaneAgents(config, flash, { implement: { model: "cli-model" } });

		assert.equal(lane.steps.implement.model, "cli-model");
		assert.equal(lane.steps.design.model, "flash-model");
	});
});

describe("lane argv", () => {
	test("forwards behavior and withholds scheduling inputs", () => {
		const base = options(
			[flash, deep],
			[
				"queue",
				"run",
				"--parallel",
				"2",
				"--ignore-setup",
				"--push-and-delete",
				"--land",
				"--create-pr",
				"--max-issues",
				"9",
			],
		);

		const args = laneArgs({
			batch: "U2",
			logPath: "unused.log",
			options: base,
			profile: flash,
		});

		assert.deepEqual(args, [
			"queue",
			"run",
			"--name",
			"U2",
			"--once",
			"--profile",
			"flash",
			"--base",
			"main",
			"--ignore-setup",
			"--push-and-delete",
		]);
		assert.ok(!args.includes("--land"));
		assert.ok(!args.includes("--create-pr"));
		assert.ok(!args.includes("--parallel"));
		assert.ok(!args.includes("--max-issues"));
	});

	test("forwards resume policy and the base ref", () => {
		const parsed = options([flash], ["queue", "run", "--no-resume"]);
		const args = laneArgs({
			batch: "U2",
			logPath: "unused.log",
			options: { ...parsed, base: "trunk" },
			profile: flash,
		});

		assert.ok(args.includes("--no-resume"));
		assert.deepEqual(args.slice(args.indexOf("--base"), args.indexOf("--base") + 2), [
			"--base",
			"trunk",
		]);
	});
});

describe("parallel pool", () => {
	test("runs independent batches concurrently, one profile per lane", async () => {
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
			],
			[makeIssue(5), makeIssue(6)],
		);
		const parsed = options([flash, deep], ["queue", "run", "--parallel", "2"]);

		const started: Array<string> = [];
		const { output } = await capture(async () => {
			const result = await runParallelPool(parsed, async (params: LaneSpawnParams) => {
				started.push(`${params.batch}:${params.profile.name}`);
				return { ok: true };
			});

			assert.deepEqual(result.batches.sort(), ["U1", "U2"]);
			assert.equal(result.failures.length, 0);
			assert.equal(result.completed.length, 2);
			return result;
		});

		assert.deepEqual(started, ["U1:flash", "U2:deep"]);
		assert.match(output, /Lane 1: "U1" \[flash\]/u);
		assert.match(output, /Lane 2: "U2" \[deep\]/u);
	});

	test("a serialization rule keeps two batches out of the same pool slot", async () => {
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
			],
			[makeIssue(5), makeIssue(6)],
		);

		// R1 says #5 and #6 must never be in flight together.
		writeQueueManifest(
			{
				...emptyQueueManifest(),
				sequences: [
					{ issues: ["5"], name: "U1" },
					{ issues: ["6"], name: "U2" },
				],
				serialized: [{ issues: ["5", "6"], name: "R1", reason: "same file" }],
			},
			manifestPath,
		);

		const parsed = options([flash, deep], ["queue", "run", "--parallel", "2"]);
		const concurrent: Array<string> = [];
		let live = 0;
		let peak = 0;

		const { value } = await capture(async () =>
			runParallelPool(parsed, async (params) => {
				live += 1;
				peak = Math.max(peak, live);
				concurrent.push(params.batch);
				await Promise.resolve();
				live -= 1;
				return { ok: true };
			}),
		);

		assert.ok(value.batches.length >= 1);
		// Both may run, but never at the same time: the second waits for the first to be reserved.
		assert.equal(peak, 1, `peak concurrency should be 1, saw ${concurrent.join(",")}`);
	});

	test("keeps going after a failed lane and reports every failure", async () => {
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
				{ issues: ["7"], name: "U3" },
			],
			[makeIssue(5), makeIssue(6), makeIssue(7)],
		);
		const parsed = options([flash], ["queue", "run", "--parallel", "1"]);

		const { output, value } = await capture(async () =>
			runParallelPool(parsed, async (params) =>
				params.batch === "U2" ? { error: "boom", ok: false } : { ok: true },
			),
		);

		assert.deepEqual(value.batches, ["U1", "U2", "U3"]);
		assert.deepEqual(
			value.failures.map((failure) => failure.batch),
			["U2"],
		);
		assert.deepEqual(
			value.completed.map((run) => run.batch),
			["U1", "U3"],
		);
		assert.match(output, /"U2" \[flash\] failed/u);
	});

	test("refuses a batch that would overshoot the budget", async () => {
		stage(
			[
				{ issues: ["5", "6"], name: "U1" },
				{ issues: ["7"], name: "U2" },
			],
			[makeIssue(5), makeIssue(6), makeIssue(7)],
		);
		const parsed = options([flash], ["queue", "run", "--parallel", "2", "--max-issues", "2"]);

		const { value } = await capture(async () =>
			runParallelPool(parsed, async () => ({ ok: true })),
		);

		// U1 fits exactly; U2's single member would be the third dispatch.
		assert.deepEqual(value.batches, ["U1"]);
	});

	test("a dry run names each lane without spawning it", async () => {
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
			],
			[makeIssue(5), makeIssue(6)],
		);
		const parsed = options([flash, deep], ["queue", "run", "--parallel", "2", "--dry-run"]);
		let spawned = 0;

		const { output, value } = await capture(async () =>
			runParallelPool(parsed, async () => {
				spawned += 1;
				return { ok: true };
			}),
		);

		assert.equal(spawned, 0);
		assert.equal(value.failures.length, 0);
		assert.match(output, /\(dry run\) lane 1 would fire "U1" \[flash\]/u);
		assert.match(output, /\(dry run\) lane 2 would fire "U2" \[deep\]/u);
	});

	test("a dry run under --json emits one lane object per prediction", async () => {
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
			],
			[makeIssue(5), makeIssue(6)],
		);
		const parsed = options(
			[flash, deep],
			["queue", "run", "--parallel", "2", "--dry-run", "--json"],
		);

		const { output } = await capture(async () =>
			runParallelPool(parsed, async () => ({ ok: true })),
		);
		const objects = output
			.split(/\r?\n/u)
			.filter((line) => line.trim().startsWith("{"))
			.map((line) => JSON.parse(line) as Record<string, unknown>);

		assert.equal(objects.length, 2);
		assert.deepEqual(objects[0], {
			batch: "U1",
			dryRun: true,
			issues: ["5"],
			kind: "lane",
			lane: 1,
			profile: "flash",
		});
		assert.equal(objects[1]?.batch, "U2");
		assert.equal(objects[1]?.profile, "deep");
	});

	test("a free lane names why it stayed free", async () => {
		/* U2's member is not ready, so lane 2 has nothing to run once lane 1 starts. */
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
			],
			[makeIssue(5), { ...makeIssue(6), labels: [] }],
		);
		const parsed = options([flash, deep], ["queue", "run", "--parallel", "2"]);

		const { output, value } = await capture(async () =>
			runParallelPool(parsed, async () => ({ ok: true })),
		);

		assert.deepEqual(value.batches, ["U1"]);
		assert.equal(value.idleReasons?.length, 1);
		assert.match(value.idleReasons?.[0] ?? "", /U2.*GATED.*missing ready-for-agent/u);
		assert.match(output, /1 lane\(s\) idle: sequence "U2" is GATED/u);
	});

	test("a saturated pool reports no idle reason", async () => {
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
			],
			[makeIssue(5), makeIssue(6)],
		);
		const parsed = options([flash, deep], ["queue", "run", "--parallel", "2"]);

		const { value } = await capture(async () =>
			runParallelPool(parsed, async () => ({ ok: true })),
		);

		assert.deepEqual(value.idleReasons, []);
	});

	test("the pool reports its own duration, saturation, and per-batch timings", async () => {
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
			],
			[makeIssue(5), makeIssue(6)],
		);
		const parsed = options([flash, deep], ["queue", "run", "--parallel", "2"]);

		const { output, value } = await capture(async () =>
			runParallelPool(parsed, async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return { ok: true };
			}),
		);

		assert.ok((value.elapsedMs ?? 0) >= 10, "elapsed must cover the lanes' work");
		assert.ok((value.saturatedMs ?? 0) > 0, "both lanes were busy for part of the run");
		assert.match(output, /── 2 batch\(es\) in /u);
		assert.match(output, /\d+% of lanes busy/u);
		assert.match(output, /✓ U1 \[flash\]/u);
		assert.match(output, /✓ U2 \[deep\]/u);
	});

	test("the pool emits a JSON summary object when running, and not on a dry run", async () => {
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
			],
			[makeIssue(5), makeIssue(6)],
		);
		const parsed = options([flash, deep], ["queue", "run", "--parallel", "2", "--json"]);

		const { output } = await capture(async () =>
			runParallelPool(parsed, async () => {
				await new Promise((resolve) => setTimeout(resolve, 15));
				return { ok: true };
			}),
		);
		const pool = output
			.split(/\r?\n/u)
			.filter((line) => line.trim().startsWith("{"))
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.find((object) => object.kind === "pool");

		assert.ok(pool !== undefined, "a real run must emit one pool object");
		assert.deepEqual(pool.batches, ["U1", "U2"]);
		/* Both lanes were busy for the whole run, so nearly all of it counted as saturated. */
		assert.equal(typeof pool.utilization, "number");
		assert.ok(
			(pool.utilization as number) >= 80,
			`expected high utilization, got ${String(pool.utilization)}`,
		);
		assert.deepEqual(pool.idleReasons, []);
	});

	test("a freed lane slot is reused rather than numbered as a new lane", async () => {
		/*
		 * Three batches across two lanes: the third must run in a *reused* slot, not in a fictional
		 * "lane 3". Numbering each batch afresh would make a lane a batch counter, and the per-lane
		 * utilization report built on it would describe nothing.
		 */
		stage(
			[
				{ issues: ["5"], name: "U1" },
				{ issues: ["6"], name: "U2" },
				{ issues: ["7"], name: "U3" },
			],
			[makeIssue(5), makeIssue(6), makeIssue(7)],
		);
		const parsed = options([flash, deep], ["queue", "run", "--parallel", "2"]);

		const { output, value } = await capture(async () =>
			runParallelPool(parsed, async ({ batch }) => {
				await new Promise((resolve) => setTimeout(resolve, batch === "U3" ? 40 : 5));
				return { ok: true };
			}),
		);

		const lanes = value.lanes ?? [];
		assert.equal(
			lanes.length,
			2,
			`two slots must be reused, not three lane numbers; output:\n${output}`,
		);
		assert.deepEqual(
			lanes.map((lane) => lane.lane),
			[0, 1],
			"lane indices must be slot numbers",
		);

		const busy = lanes.reduce((sum, lane) => sum + lane.busyMs, 0);
		assert.ok(busy > 0, "busy time must be measured");
		for (const lane of lanes) {
			assert.ok(lane.idleMs >= 0, "idle time can never be negative");
		}

		/* The slot that ran two batches must name both; the long batch's slot names one. */
		const twoBatches = lanes.find((lane) => lane.batches.length === 2);
		assert.ok(
			twoBatches !== undefined,
			`one slot must have run two batches; output:\n${output}`,
		);
		assert.deepEqual(
			twoBatches.batches.map((entry) => entry.batch),
			["U1", "U3"],
		);
		assert.match(output, /lane 0: .*2 batch\(es\): U1, U3/u);
	});

	test("a pool that fires nothing reports the exhaustion reason", async () => {
		stage([{ issues: ["5"], name: "U1" }], [{ ...makeIssue(5), labels: [] }]);
		const parsed = options([flash], ["queue", "run", "--parallel", "2"]);

		const { output, value } = await capture(async () =>
			runParallelPool(parsed, async () => ({ ok: true })),
		);

		assert.deepEqual(value.batches, []);
		assert.match(output, /⏹ Nothing to run: sequence "U1" is GATED/u);
	});
});

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { CliOptions } from "../cli.js";
import { parseArgs } from "../cli.js";
import { config, io } from "../runtime.js";
import { writeState } from "../state.js";
import { cleanupIssueArtifacts, makeState, registerTestHooks, tmpRoot } from "../test-helpers.js";
import { queueLockPath, runLockName } from "./lock.js";
import {
	emptyQueueManifest,
	type QueueManifest,
	readQueueManifest,
	writeQueueManifest,
} from "./manifest.js";
import { type QueueDispatch, type QueueLand, runQueueRun } from "./run.js";

registerTestHooks();

const primary = join(tmpRoot, "run-primary");
const relativeManifest = "sandcastle.queue.run.json";
const manifestPath = join(primary, relativeManifest);

/** Thrown by the exit stub so a test can assert the dispatcher's exit code. */
class ExitError extends Error {}

interface GhIssue {
	labels: Array<{ name: string }>;
	number: number;
	state: string;
	title: string;
}

/**
 * Stubs the three `gh` surfaces the dispatcher uses: the issue list (drives live state and drift),
 * the batched GraphQL blocked-by query, and the per-issue comment read behind the review marker.
 * Every issue is READY and unblocked unless a test says so.
 */
function stubGh(issues: ReadonlyArray<GhIssue>): void {
	io.execSync = ((command: string) => {
		const text = String(command);
		if (text.startsWith("gh issue list")) {
			return JSON.stringify(issues);
		}

		if (text.startsWith("gh issue view")) {
			return JSON.stringify({ comments: [{ body: `${config.reviewMarker}: APPROVED` }] });
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
					{
						blockedBy: { nodes: [] },
						number: entry.number,
						state: entry.state,
					},
				]),
			);
			return JSON.stringify({ data: { repository: nodes } });
		}

		throw new Error(`unexpected execFileSync: ${command} ${argv.join(" ")}`);
	}) as typeof io.execFileSync;
}

function makeIssue(number: number, extra: Partial<GhIssue> = {}): GhIssue {
	return {
		labels: [{ name: config.labels.readyForAgent }],
		number,
		state: "OPEN",
		title: `feat(queue): issue ${String(number)}`,
		...extra,
	};
}

/**
 * Writes complete phase state for an issue, so it reads as landed to anything keyed on approval.
 *
 * @remarks
 *   Pruning must ignore this and go by the live CLOSED state instead, which is what the tests below
 *   pin down: a regression back to an approval-keyed prune would drop the still-open member.
 */
function approve(issue: string): void {
	writeState(
		makeState(issue, {
			commits: ["abc"],
			design: "done",
			implement: "done",
			review: "done",
		}),
	);
}

/** Writes a manifest, stubs `gh`, and stubs `io.exit` so the loop's exits are observable. */
function stage(
	sequences: QueueManifest["sequences"],
	live: ReadonlyArray<GhIssue>,
): { codes: Array<number> } {
	rmSync(manifestPath, { force: true });
	rmSync(queueLockPath(runLockName), { force: true });
	config.queue.file = relativeManifest;
	config.queue.commit = false;
	writeQueueManifest({ ...emptyQueueManifest(), sequences }, manifestPath);
	stubGh(live);

	const codes: Array<number> = [];
	io.exit = (code: number): never => {
		codes.push(code);
		throw new ExitError(`exit ${String(code)}`);
	};

	return { codes };
}

interface RunResult {
	calls: Array<{ issues: Array<string>; resume: boolean }>;
	output: string;
}

/**
 * - Runs the dispatcher with a dispatch stub, capturing calls and stdout.
 * - @param argv - CLI arguments, before the injected `--model`.
 * - @param options - `reject: true` swallows the dispatcher's exit.
 * - @returns The dispatch calls and everything written to stdout.
 *
 * @rejects {Error} When the dispatcher exits and the test asked to observe the exit.
 */
async function run(
	argv: ReadonlyArray<string>,
	options: { dispatch?: QueueDispatch; land?: QueueLand; reject?: boolean } = {},
): Promise<RunResult> {
	const calls: RunResult["calls"] = [];
	// Records every call; an injected stub runs first so it can mutate the manifest mid-run.
	const dispatch: QueueDispatch = async (issues, runOptions: CliOptions, resume) => {
		await options.dispatch?.(issues, runOptions, resume);
		calls.push({ issues: [...issues], resume });
	};

	const lines: Array<string> = [];
	const original = console.log;
	const originalError = console.error;
	console.log = ((...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	}) as typeof console.log;
	console.error = () => undefined;
	try {
		await runQueueRun(parseArgs([...argv, "--model", "test-model"]), {
			dispatch,
			land: options.land,
		});
	} catch (err) {
		if (options.reject !== true || !(err instanceof ExitError)) {
			throw err;
		}
	} finally {
		console.log = original;
		console.error = originalError;
	}

	return { calls, output: lines.join("\n") };
}

/**
 * - A dispatch stub that appends #7 to U2 the first time it is called.
 * - @returns A dispatch that rewrites the manifest once, then no-ops.
 * - @remarks This is what a review running inside a batch does: it registers a follow-up into the
 *   batch the dispatcher is still working through, so the next iteration sees a member it has not
 *   run yet.
 */
function registeringFollowUp(): QueueDispatch {
	let registered = false;
	return () => {
		if (!registered) {
			registered = true;
			writeQueueManifest(
				{
					...emptyQueueManifest(),
					sequences: [
						{ issues: ["5", "7"], name: "U2" },
						{ issues: ["6"], name: "U3" },
					],
				},
				manifestPath,
			);
		}

		return Promise.resolve();
	};
}

describe("queue run dispatch", () => {
	test("exits 1 without dispatching when no sequence is ready", async () => {
		const { codes } = stage([], [makeIssue(5)]);

		const result = await run(["queue", "run"], { reject: true });

		assert.deepEqual(codes, [1]);
		assert.deepEqual(result.calls, []);
		assert.match(result.output, /Nothing to run/u);
	});

	test("fires a READY sequence and resumes by default", async () => {
		stage([{ issues: ["5"], name: "U2" }], [makeIssue(5)]);

		const result = await run(["queue", "run"], { reject: true });

		assert.deepEqual(result.calls, [{ issues: ["5"], resume: true }]);
		assert.match(result.output, /Firing sequence "U2"/u);
	});

	test("--no-resume asks for a clean re-run", async () => {
		stage([{ issues: ["5"], name: "U2" }], [makeIssue(5)]);

		const result = await run(["queue", "run", "--no-resume"], { reject: true });

		assert.deepEqual(result.calls, [{ issues: ["5"], resume: false }]);
	});

	test("refuses a batch that would exceed --max-issues instead of splitting it", async () => {
		stage([{ issues: ["5", "6"], name: "U2" }], [makeIssue(5), makeIssue(6)]);

		const result = await run(["queue", "run", "--max-issues", "1"], { reject: true });

		assert.deepEqual(result.calls, []);
		assert.match(result.output, /exceeds the remaining budget \(1\)/u);
	});

	test("fires a batch that fits the budget exactly, then stops", async () => {
		stage([{ issues: ["5", "6"], name: "U2" }], [makeIssue(5), makeIssue(6)]);

		const result = await run(["queue", "run", "--max-issues", "2"], { reject: true });

		assert.deepEqual(result.calls, [{ issues: ["5", "6"], resume: true }]);
		assert.match(result.output, /Reached --max-issues 2/u);
	});

	test("--require-clean refuses to fire while drift exists", async () => {
		const { codes } = stage([{ issues: ["5"], name: "U2" }], [makeIssue(5), makeIssue(9)]);

		const result = await run(["queue", "run", "--require-clean"], { reject: true });

		assert.deepEqual(codes, [1]);
		assert.deepEqual(result.calls, []);
		assert.match(result.output, /#9 is open and ready-for-agent but not placed/u);
	});

	test("drift alone does not stop a run", async () => {
		stage([{ issues: ["5"], name: "U2" }], [makeIssue(5), makeIssue(9)]);

		const result = await run(["queue", "run"], { reject: true });

		assert.deepEqual(result.calls, [{ issues: ["5"], resume: true }]);
		assert.match(result.output, /1 drift item/u);
	});

	test("--dry-run prints the decision and dispatches nothing", async () => {
		stage([{ issues: ["5"], name: "U2" }], [makeIssue(5)]);

		const result = await run(["queue", "run", "--dry-run"], { reject: true });

		assert.deepEqual(result.calls, []);
		assert.match(result.output, /dry run — nothing dispatched/u);
	});

	test("--json keeps stdout machine-readable", async () => {
		stage([{ issues: ["5"], name: "U2" }], [makeIssue(5), makeIssue(9)]);

		const result = await run(["queue", "run", "--json", "--dry-run"], { reject: true });

		for (const line of result.output.split("\n")) {
			assert.doesNotThrow(() => {
				JSON.parse(line) as unknown;
			});
		}
	});

	test("keeps a batch whose members are approved but still open", async () => {
		stage([{ issues: ["5"], name: "U2" }], [makeIssue(5)]);
		approve("5");

		try {
			await run(["queue", "run"], { reject: true });

			assert.deepEqual(
				readQueueManifest().sequences.map((sequence) => sequence.issues),
				[["5"]],
				"an open member has not landed, so a pull request closed unmerged must leave it recoverable",
			);
		} finally {
			cleanupIssueArtifacts("5");
		}
	});

	test("prunes a member GitHub has closed and drops the emptied batch", async () => {
		stage([{ issues: ["5"], name: "U2" }], [makeIssue(5, { state: "CLOSED" })]);
		approve("5");

		try {
			await run(["queue", "run"], { reject: true });

			assert.deepEqual(readQueueManifest().sequences, [], "a landed batch leaves the queue");
		} finally {
			cleanupIssueArtifacts("5");
		}
	});

	test("releases the run lock", async () => {
		stage([{ issues: ["5"], name: "U2" }], [makeIssue(5)]);

		await run(["queue", "run", "--dry-run"], { reject: true });

		assert.equal(existsSync(queueLockPath(runLockName)), false);
	});

	test("finishes the batch it just ran when a review appended a member mid-run", async () => {
		stage(
			[
				{ issues: ["5"], name: "U2" },
				{ issues: ["6"], name: "U3" },
			],
			[makeIssue(5), makeIssue(6), makeIssue(7)],
		);

		const dispatch = registeringFollowUp();

		const result = await run(["queue", "run"], { dispatch, reject: true });

		assert.deepEqual(
			result.calls.map((call) => call.issues),
			[["5"], ["5", "7"], ["6"]],
			"U2 resumes with #7 instead of falling through to U3",
		);
		assert.match(result.output, /Firing sequence "U2"/u);
	});

	test("stops and names the batch when the grown member cannot run", async () => {
		const { codes } = stage(
			[
				{ issues: ["5"], name: "U2" },
				{ issues: ["6"], name: "U3" },
			],
			[makeIssue(5), makeIssue(6), makeIssue(7, { labels: [] })],
		);

		const dispatch = registeringFollowUp();

		const result = await run(["queue", "run"], { dispatch, reject: true });

		assert.deepEqual(
			result.calls.map((call) => call.issues),
			[["5"]],
			"U3 must not be fired ahead of the unfinished U2",
		);
		assert.match(result.output, /grew #7 mid-run but is GATED/u);
		assert.deepEqual(codes, [], "stopping is not a failure exit");
	});

	test("--land exits 2 when the hand-off failed, even with nothing else left to run", async () => {
		const { codes } = stage([{ issues: ["5"], name: "U2" }], [makeIssue(5)]);

		const result = await run(["queue", "run", "--land"], {
			land: () => Promise.resolve({ error: "integration has no manifest", ok: false }),
			reject: true,
		});

		assert.deepEqual(codes, [2]);
		assert.match(result.output, /1 hand-off failure\(s\): U2/u);
		assert.match(result.output, /U2: integration has no manifest/u);
	});

	test("--land exits 1 when the hand-off completed and nothing else is left to run", async () => {
		const { codes } = stage([{ issues: ["5"], name: "U2" }], [makeIssue(5)]);

		const result = await run(["queue", "run", "--land"], {
			land: () => Promise.resolve({ ok: true }),
			reject: true,
		});

		assert.deepEqual(codes, [1], "an exhausted queue is exit 1, not a hand-off failure");
		assert.doesNotMatch(result.output, /hand-off failure/u);
	});

	test("--json reports the hand-off outcome and the failing exit", async () => {
		const { codes } = stage([{ issues: ["5"], name: "U2" }], [makeIssue(5)]);

		const result = await run(["queue", "run", "--land", "--json"], {
			land: () => Promise.resolve({ error: "blocked", ok: false }),
			reject: true,
		});

		const entries = result.output
			.split("\n")
			.filter((line) => line !== "")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const reported = entries
			.map((entry) => entry.handOff)
			.filter(
				(handOff): handOff is { batch: string; ok: boolean } =>
					typeof handOff === "object" && handOff !== null,
			);

		assert.deepEqual(codes, [2]);
		assert.deepEqual(reported, [{ batch: "U2", error: "blocked", ok: false }]);
	});
});

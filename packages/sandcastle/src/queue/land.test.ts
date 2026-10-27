/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";

import { parseArgs } from "../cli.js";
import { config, io } from "../runtime.js";
import { registerTestHooks, tmpRoot } from "../test-helpers.js";
import {
	landPrBody,
	landPrCommands,
	landPrTitle,
	resolveLandTarget,
	runQueueLand,
	staleComposition,
} from "./land.js";
import { emptyQueueManifest, type QueueManifest, writeQueueManifest } from "./manifest.js";

registerTestHooks();

function manifest(overrides: Partial<QueueManifest> = {}): QueueManifest {
	return {
		...emptyQueueManifest(),
		sequences: [
			{
				issues: ["382", "383"],
				name: "ui-wiring-work",
				notes: "one run\n382 shell → 383 data seam",
				roles: { "382": "shell + ScreenHost" },
				title: "ui wiring",
			},
		],
		...overrides,
	};
}

const primary = join(tmpRoot, "land-primary");
const relativeManifest = "sandcastle.queue.land.json";

/** Source entries as the integration manifest records them. */
const staleMember = {
	branch: "sandcastle/issue-382",
	commit: "abc1234",
	issue: "382",
	name: "issue-382",
	order: 1,
};
const tailMember = {
	branch: "sandcastle/issue-383",
	commit: "def5678",
	issue: "383",
	name: "issue-383",
	order: 1,
};

/** A composition manifest, loose enough for the seams under test. */
function composition(
	status: string,
	sources: Array<Record<string, unknown>>,
	headCommit?: string,
): never {
	return {
		headCommit,
		kind: "issues",
		name: "ui-wiring-work",
		sources,
		status,
	} as never;
}

/** Points the queue at a staged manifest and stubs the one git call path resolution needs. */
function stageQueue(queue: QueueManifest = manifest()): void {
	config.queue.file = relativeManifest;
	config.queue.commit = false;
	writeQueueManifest(queue, join(primary, relativeManifest));

	io.execFileSync = ((command: string, args?: string | ReadonlyArray<string>) => {
		const argv = Array.isArray(args) ? args.map(String) : [];
		if (command === "git" && argv.includes("--git-common-dir")) {
			return join(primary, ".git");
		}

		throw new Error(`unexpected execFileSync: ${command} ${argv.join(" ")}`);
	}) as typeof io.execFileSync;
}

/** Runs a landing while capturing the lines it reports. */
async function capture(run: () => Promise<void>): Promise<string> {
	const lines: Array<string> = [];
	const original = console.log;
	console.log = ((...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	}) as typeof console.log;
	try {
		await run();
	} finally {
		console.log = original;
	}

	return lines.join("\n");
}

describe("queue landing", () => {
	test("resolves the tail, members, roles, and quoted notes of a batch", () => {
		const target = resolveLandTarget(manifest(), "ui-wiring-work");

		assert.equal(target.tail, "383");
		assert.deepEqual(target.issues, ["382", "383"]);
		assert.deepEqual(target.notes, ["one run", "382 shell → 383 data seam"]);
		assert.equal(target.roles?.["382"], "shell + ScreenHost");
	});

	test("refuses an unknown batch, naming the ones that exist", () => {
		assert.throws(
			() => resolveLandTarget(manifest(), "nope-work"),
			/No batch named "nope-work" in the queue manifest\. Batches: ui-wiring-work\./u,
		);
	});

	test("refuses a batch with no members rather than composing nothing", () => {
		assert.throws(
			() =>
				resolveLandTarget(
					manifest({ sequences: [{ issues: [], name: "empty-work" }] }),
					"empty-work",
				),
			/has no members to compose/u,
		);
	});

	test("titles the pull request in conventional format so commitlint-gated merges accept it", () => {
		assert.equal(
			landPrTitle(resolveLandTarget(manifest(), "ui-wiring-work")),
			"chore(integration): land ui-wiring-work (ui wiring)",
		);
		assert.equal(
			landPrTitle(
				resolveLandTarget(
					manifest({ sequences: [{ issues: ["1"], name: "solo-work" }] }),
					"solo-work",
				),
			),
			"chore(integration): land solo-work",
		);
	});

	test("closes every member from the body, and says what each member did", () => {
		const body = landPrBody(resolveLandTarget(manifest(), "ui-wiring-work"));

		assert.match(body, /Members in run order: #382 shell \+ ScreenHost, #383/u);
		assert.match(body, /> one run/u);
		assert.deepEqual(
			body.split("\n").filter((line) => line.startsWith("Closes #")),
			["Closes #382", "Closes #383"],
		);
	});

	test("reports a composition built from a tail the batch has moved past", () => {
		const target = resolveLandTarget(manifest(), "ui-wiring-work");
		const stale = staleComposition(
			composition("aborted", [staleMember]),
			target,
			() => undefined,
		);

		assert.equal(stale.length, 1);
		assert.match(stale[0] ?? "", /composed from issue-382, but the batch's tail is now #383/u);
	});

	test("reports a member branch that moved after it was composed", () => {
		const target = resolveLandTarget(manifest(), "ui-wiring-work");
		const stale = staleComposition(
			composition("aborted", [tailMember]),
			target,
			() => "c0ffee7",
		);

		assert.equal(stale.length, 1);
		assert.match(
			stale[0] ?? "",
			/issue-383 moved to c0ffee7 since it was composed at def5678/u,
		);
	});

	test("reports a member the batch no longer carries", () => {
		const target = resolveLandTarget(manifest(), "ui-wiring-work");
		const stale = staleComposition(
			composition("aborted", [
				tailMember,
				{
					branch: "sandcastle/issue-999",
					commit: "f00d123",
					issue: "999",
					name: "issue-999",
					order: 2,
				},
			]),
			target,
			() => undefined,
		);

		assert.deepEqual(stale, ["the batch no longer carries #999"]);
	});

	test("keeps a composition that still matches its batch", () => {
		const target = resolveLandTarget(manifest(), "ui-wiring-work");

		assert.deepEqual(
			staleComposition(composition("aborted", [tailMember]), target, () => "def5678"),
			[],
		);
		assert.deepEqual(
			staleComposition(
				{ kind: "integrations", name: "ui-wiring-work", sources: [] } as never,
				target,
				() => "def5678",
			),
			[],
			"an integration of integrations has no tail to compare",
		);
	});

	test("publishes with one push and one PR: sandcastle never merges", () => {
		const commands = landPrCommands(resolveLandTarget(manifest(), "ui-wiring-work"), "main");

		assert.deepEqual(
			commands.map((command) => command.file),
			["git", "gh"],
		);
		assert.deepEqual(commands[0]?.args, [
			"push",
			"-u",
			"origin",
			"sandcastle/integration/ui-wiring-work",
		]);
		assert.equal(commands[1]?.args[0], "pr");
		assert.ok(commands[1]?.args.includes("sandcastle/integration/ui-wiring-work"));
		assert.ok(
			commands.some((command) => command.line.includes("gh pr create --base main")),
			"the printed path must be runnable by hand",
		);
		assert.ok(
			!commands.some((command) => command.args.includes("merge")),
			"landing hands the merge to a human",
		);
	});

	test("refuses to hand over a composition built from a tail the batch has moved past", async () => {
		stageQueue();
		let composed = false;

		await assert.rejects(
			runQueueLand(parseArgs(["queue", "land", "--name", "ui-wiring-work"]), {
				compose: () => {
					composed = true;
					return Promise.resolve();
				},
				integration: () => composition("aborted", [staleMember]),
			}),
			/Rebuild it with `pnpm sandcastle queue land --name ui-wiring-work --recompose`/u,
		);
		assert.equal(composed, false, "a stale composition must not be resumed before it is reset");
	});

	test("--recompose resets a stale composition and composes the batch again", async () => {
		stageQueue();
		const resets: Array<string> = [];
		let composed = false;

		const output = await capture(async () => {
			await runQueueLand(
				parseArgs(["queue", "land", "--name", "ui-wiring-work", "--recompose"]),
				{
					compose: () => {
						composed = true;
						return Promise.resolve();
					},
					integration: () =>
						composed
							? composition("ready-for-human-merge", [tailMember], "def5678")
							: composition("aborted", [staleMember]),
					reset: (name: string) => {
						resets.push(name);
					},
					run: () => "",
				},
			);
		});

		assert.deepEqual(resets, ["ui-wiring-work"]);
		assert.equal(composed, true);
		assert.match(output, /↺ Recomposing "ui-wiring-work"/u);
		assert.match(output, /Open the pull request yourself/u);
	});

	test("--recompose rebuilds an unfinished composition that still matches the batch", async () => {
		stageQueue();
		const resets: Array<string> = [];
		let composed = false;

		await capture(async () => {
			await runQueueLand(
				parseArgs(["queue", "land", "--name", "ui-wiring-work", "--recompose"]),
				{
					compose: () => {
						composed = true;
						return Promise.resolve();
					},
					integration: () =>
						composed
							? composition("ready-for-human-merge", [tailMember], "def5678")
							: composition("blocked", [tailMember]),
					reset: (name: string) => {
						resets.push(name);
					},
					run: () => "",
				},
			);
		});

		assert.deepEqual(resets, ["ui-wiring-work"]);
		assert.equal(composed, true);
	});

	test("--recompose leaves a composition that is ready for the human merge alone", async () => {
		stageQueue();
		const resets: Array<string> = [];

		const output = await capture(async () => {
			await runQueueLand(
				parseArgs(["queue", "land", "--name", "ui-wiring-work", "--recompose"]),
				{
					compose: () => Promise.resolve(),
					integration: () =>
						composition("ready-for-human-merge", [tailMember], "def5678"),
					reset: (name: string) => {
						resets.push(name);
					},
					run: () => "",
				},
			);
		});

		assert.deepEqual(
			resets,
			[],
			"rebuilding a finished composition would throw its review away",
		);
		assert.match(output, /Open the pull request yourself/u);
		assert.doesNotMatch(output, /Recomposing/u);
	});
});

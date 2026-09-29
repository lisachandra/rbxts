/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import { landPrBody, landPrCommands, landPrTitle, resolveLandTarget } from "./land.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";

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

	test("titles the pull request with the batch name, reading as the batch's title when it has one", () => {
		assert.equal(
			landPrTitle(resolveLandTarget(manifest(), "ui-wiring-work")),
			"ui-wiring-work: ui wiring",
		);
		assert.equal(
			landPrTitle(
				resolveLandTarget(
					manifest({ sequences: [{ issues: ["1"], name: "solo-work" }] }),
					"solo-work",
				),
			),
			"solo-work",
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
});

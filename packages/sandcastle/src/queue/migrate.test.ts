/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { registerTestHooks, tmpRoot } from "../test-helpers.js";
import {
	migrateQueueManifest,
	parseMigrationAssigns,
	readRawQueueManifest,
	renderQueueMigration,
} from "./migrate.js";

registerTestHooks();

/** A v1 manifest: short codes in `name`, integrations in `mergeName`, gates in `afterMerge`. */
function v1(sequences: Array<Record<string, unknown>>): Record<string, unknown> {
	return {
		gated: [{ issue: "9", joins: "V", reason: "needs the surface seam" }],
		human: [{ issue: "40", reason: "human decision session" }],
		sequences,
		serialized: [{ issues: ["1", "2"], name: "R2", reason: "same seam" }],
		version: 1,
	};
}

describe("queue migration assigns", () => {
	test("parses <old>=<integration> pairs and tolerates an absent flag", () => {
		assert.deepEqual(parseMigrationAssigns(undefined), {});
		assert.deepEqual(parseMigrationAssigns("  "), {});
		assert.deepEqual(parseMigrationAssigns("V3=vfx-mounts-work, U3=pause-hub-work"), {
			U3: "pause-hub-work",
			V3: "vfx-mounts-work",
		});
	});

	test("refuses an entry that is not a pair, or names a branch-shaped integration", () => {
		assert.throws(() => parseMigrationAssigns("V3"), /--assign entries look like/u);
		assert.throws(
			() => parseMigrationAssigns("V3=sandcastle/issue-1"),
			/--assign entries look like/u,
		);
	});
});

describe("queue migration", () => {
	test("renames a batch to its integration, remaps its gate, and stamps version 2", () => {
		const report = migrateQueueManifest(
			v1([
				{ issues: ["1"], mergeName: "audio-seam-work", name: "A1" },
				{
					afterMerge: "audio-seam-work",
					issues: ["2"],
					mergeName: "vfx-surface-work",
					name: "V",
				},
			]),
		);

		assert.deepEqual(report.renames, [
			{ from: "A1", to: "audio-seam-work" },
			{ from: "V", to: "vfx-surface-work" },
		]);
		assert.equal(report.manifest.version, 2);
		assert.deepEqual(
			report.manifest.sequences.map((sequence) => sequence.name),
			["audio-seam-work", "vfx-surface-work"],
		);
		assert.equal(report.manifest.sequences[1]?.after, "audio-seam-work");
		assert.deepEqual(report.unmapped, []);
	});

	test("remaps a joins value and a gate that named a v1 short code", () => {
		const report = migrateQueueManifest(
			v1([
				{ issues: ["1"], mergeName: "ui-wiring-work", name: "U2" },
				{ afterMerge: "U2", issues: ["2"], name: "U3" },
				{ issues: ["5"], mergeName: "vfx-surface-work", name: "V" },
			]),
			{ U3: "pause-hub-work" },
		);

		assert.deepEqual(report.joins, [{ from: "V", issue: "9", to: "vfx-surface-work" }]);
		assert.deepEqual(report.gates, [
			{ batch: "pause-hub-work", from: "U2", to: "ui-wiring-work" },
		]);
	});

	test("a batch with no integration name is reported instead of guessed", () => {
		const report = migrateQueueManifest(v1([{ issues: ["1"], name: "V3" }]));

		assert.deepEqual(report.unmapped, ["V3"]);
		assert.deepEqual(report.renames, []);
	});

	test("--assign names the batches v1 left unnamed and is otherwise ignored", () => {
		const report = migrateQueueManifest(v1([{ issues: ["1"], name: "V3" }]), {
			GONE: "nothing-work",
			V3: "vfx-mounts-work",
		});

		assert.deepEqual(report.unmapped, []);
		assert.deepEqual(report.renames, [{ from: "V3", to: "vfx-mounts-work" }]);
		assert.deepEqual(report.ignoredAssigns, ["GONE"]);
	});

	test("two batches claiming one integration fold into one, keeping run order and reporting the lost prose", () => {
		const report = migrateQueueManifest(
			v1([
				{ issues: ["162"], mergeName: "matchmaking-session-work", name: "S" },
				{
					issues: ["199"],
					mergeName: "matchmaking-session-work",
					name: "SX",
					notes: "#199 joins S",
				},
			]),
		);

		assert.deepEqual(report.folds, [
			{
				droppedNotes: "#199 joins S",
				from: "SX",
				into: "matchmaking-session-work",
				issues: ["199"],
			},
		]);
		assert.equal(report.manifest.sequences.length, 1);
		assert.deepEqual(report.manifest.sequences[0]?.issues, ["162", "199"]);
	});

	test("refuses anything that is not a readable v1 manifest", () => {
		assert.throws(
			() => migrateQueueManifest({ sequences: "no" }),
			/not a readable v1 manifest/u,
		);
	});

	test("renders the renames, folds, remaps, and blockers it found", () => {
		const report = migrateQueueManifest(
			v1([
				{ issues: ["1"], mergeName: "audio-seam-work", name: "A1" },
				{ issues: ["2"], mergeName: "audio-seam-work", name: "A2", notes: "A2 joins A1" },
				{ issues: ["3"], name: "PRES" },
			]),
		);
		const lines = renderQueueMigration(report).join("\n");

		assert.match(lines, /A1 → audio-seam-work/u);
		assert.match(lines, /Fold: "A2" joins "audio-seam-work" \(#2\)/u);
		assert.match(lines, /dropped note: A2 joins A1/u);
		assert.match(lines, /Unmapped batches \(need --assign/u);
		assert.match(lines, /PRES/u);
	});
});

describe("raw queue manifest reads", () => {
	test("returns undefined for an absent file and throws for a non-JSON one", () => {
		const missing = join(tmpRoot, "absent-queue.json");
		assert.equal(readRawQueueManifest(missing), undefined);

		const broken = join(tmpRoot, "broken-queue.json");
		writeFileSync(broken, "{not json", "utf-8");
		assert.throws(() => readRawQueueManifest(broken), /is not valid JSON/u);
	});
});

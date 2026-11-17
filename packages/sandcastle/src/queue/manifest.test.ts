import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

import { registerTestHooks, tmpRoot } from "../test-helpers.js";
import {
	describePlacement,
	emptyQueueManifest,
	locateIssue,
	type QueueManifest,
	readQueueManifest,
	referencedIssues,
	writeQueueManifest,
} from "./manifest.js";

registerTestHooks();

function manifestPath(name: string): string {
	return join(tmpRoot, `queue-manifest-${name}.json`);
}

function sample(): QueueManifest {
	return {
		gated: [{ issue: "30", reason: "needs a design decision" }],
		human: [{ issue: "40", reason: "human decision session" }],
		sequences: [
			{
				issues: ["10", "11", "12"],
				name: "U2",
				notes: "order matters",
			},
		],
		serialized: [{ issues: ["11", "12"], name: "R1", reason: "same file" }],
		updatedAt: "2026-01-01T00:00:00.000Z",
		version: 2,
	};
}

describe("queue manifest", () => {
	test("emptyQueueManifest returns a blank v1 manifest", () => {
		assert.deepEqual(emptyQueueManifest(), {
			gated: [],
			human: [],
			sequences: [],
			serialized: [],
			updatedAt: "",
			version: 2,
		});
	});

	test("batch labels, member roles, and run-order gates survive a round trip", () => {
		const path = manifestPath("labels.json");
		const manifest: QueueManifest = {
			...emptyQueueManifest(),
			gated: [{ issue: "30", joins: "V", reason: "needs the Studio Sound instance" }],
			sequences: [
				{
					after: "audio-seam-work",
					issues: ["10", "11"],
					name: "U2",
					notes: "ui wiring · one run\n10 shell → 11 data seam",
					roles: { "10": "shell", "11": "data seam" },
					title: "ui wiring",
				},
			],
			updatedAt: "2026-01-01T00:00:00.000Z",
			version: 2,
		};
		writeQueueManifest(manifest, path);

		const read = readQueueManifest(path);
		assert.deepEqual(read.sequences, manifest.sequences);
		assert.deepEqual(read.gated, manifest.gated);
	});

	test("a role key must be a numeric issue number", () => {
		const path = manifestPath("bad-roles.json");
		writeFileSync(
			path,
			JSON.stringify({
				...emptyQueueManifest(),
				sequences: [{ issues: ["10"], name: "U2", roles: { ten: "shell" } }],
			}),
			"utf-8",
		);

		assert.throws(() => {
			readQueueManifest(path);
		}, /is invalid/u);
	});

	test("readQueueManifest returns an empty manifest when the file does not exist", () => {
		const path = manifestPath("missing.json");
		if (existsSync(path)) {
			rmSync(path);
		}

		assert.deepEqual(readQueueManifest(path), emptyQueueManifest());
	});

	test("writeQueueManifest stamps updatedAt and readQueueManifest roundtrips the manifest", () => {
		const path = manifestPath("roundtrip.json");
		writeQueueManifest(sample(), path);
		assert.ok(existsSync(path));

		const read = readQueueManifest(path);
		assert.equal(read.version, 2);
		assert.equal(read.updatedAt !== "", true);
		assert.deepEqual(read.gated, sample().gated);
		assert.deepEqual(read.human, sample().human);
		assert.deepEqual(read.sequences, sample().sequences);
		assert.deepEqual(read.serialized, sample().serialized);
	});

	test("writeQueueManifest creates missing parent directories", () => {
		const path = join(tmpRoot, "nested", "deeper", "queue.json");
		writeQueueManifest(emptyQueueManifest(), path);
		assert.ok(existsSync(path));
		assert.deepEqual(readQueueManifest(path), {
			...emptyQueueManifest(),
			updatedAt: readQueueManifest(path).updatedAt,
		});
	});

	test("readQueueManifest throws a readable error on malformed JSON", () => {
		const path = manifestPath("broken.json");
		writeQueueManifest(sample(), path);
		rmSync(path);
		writeFileSync(path, "{ not json", "utf-8");

		assert.throws(() => {
			readQueueManifest(path);
		}, /is not valid JSON/u);
	});

	test("readQueueManifest throws with the first schema message on invalid manifests", () => {
		const path = manifestPath("invalid.json");
		writeFileSync(
			path,
			JSON.stringify({ ...sample(), gated: [{ issue: "1", reason: "" }] }),
			"utf-8",
		);

		assert.throws(() => {
			readQueueManifest(path);
		}, /is invalid: gated\.0\.reason/u);
	});

	test("readQueueManifest translates a version 1 manifest instead of refusing it", () => {
		/*
		 * The manifest resolves against the primary checkout, so a worktree built before the migration
		 * reads the shared v2 file with older code. The read has to translate, or `queue list` and
		 * `queue check` fail in exactly the worktrees that need them most.
		 */
		const path = manifestPath("v1.json");
		const raw = {
			gated: [{ issue: "30", joins: "V", reason: "needs the Studio Sound instance" }],
			human: [],
			sequences: [
				{
					afterMerge: "audio-seam-work",
					issues: ["10", "11"],
					mergeName: "audio-work",
					name: "U",
				},
			],
			serialized: [],
			version: 1,
		};
		writeFileSync(path, JSON.stringify(raw), "utf-8");

		const read = readQueueManifest(path);

		assert.equal(read.version, 2);
		// `mergeName` becomes the batch name, and `afterMerge` becomes `after`.
		assert.deepEqual(read.sequences, [
			{ after: "audio-seam-work", issues: ["10", "11"], name: "audio-work" },
		]);
		// `joins` naming a v1 short code is remapped too, or the gate would point at nothing.
		assert.deepEqual(read.gated, [
			{ issue: "30", joins: "V", reason: "needs the Studio Sound instance" },
		]);
	});

	test("a version 1 read does not write the file", () => {
		const path = manifestPath("v1-readonly.json");
		const raw = {
			gated: [],
			human: [],
			sequences: [{ issues: ["10"], mergeName: "audio-work", name: "U" }],
			serialized: [],
			version: 1,
		};
		const original = JSON.stringify(raw);
		writeFileSync(path, original, "utf-8");

		readQueueManifest(path);

		// `queue migrate --apply` is the write path; a read leaves the file byte-identical.
		assert.equal(readFileSync(path, "utf-8"), original);
	});

	test("readQueueManifest refuses a version 1 batch that has no integration name", () => {
		const path = manifestPath("v1-unmapped.json");
		writeFileSync(
			path,
			JSON.stringify({
				gated: [],
				human: [],
				sequences: [{ issues: ["10"], name: "U3" }],
				serialized: [],
				version: 1,
			}),
			"utf-8",
		);

		/*
		 * Nothing in the file says which integration `U3` becomes, and guessing would silently point
		 * the batch at a branch that may not be its own. The error names the flag that answers it.
		 */
		assert.throws(() => {
			readQueueManifest(path);
		}, /batch\(es\) U3 have no integration name.*--assign/u);
	});

	test("readQueueManifest translates a version 1 fold into one batch", () => {
		const path = manifestPath("v1-fold.json");
		writeFileSync(
			path,
			JSON.stringify({
				gated: [],
				human: [],
				sequences: [
					{ issues: ["10"], mergeName: "audio-work", name: "U" },
					{ issues: ["11"], mergeName: "audio-work", name: "V" },
				],
				serialized: [],
				version: 1,
			}),
			"utf-8",
		);

		// Two v1 batches naming one integration is a fold, and v2 requires unique batch names.
		assert.deepEqual(readQueueManifest(path).sequences, [
			{ issues: ["10", "11"], name: "audio-work" },
		]);
	});

	test("referencedIssues collects every number from all sections without duplicates", () => {
		const numbers = referencedIssues(sample());
		assert.deepEqual([...numbers].sort(), ["10", "11", "12", "30", "40"]);
	});

	test("locateIssue finds sequence placement with position, buckets, or nothing", () => {
		const manifest = sample();
		assert.deepEqual(locateIssue(manifest, "10"), {
			index: 0,
			kind: "sequence",
			name: "U2",
		});
		assert.deepEqual(locateIssue(manifest, "30"), { kind: "gated" });
		assert.deepEqual(locateIssue(manifest, "40"), { kind: "human" });
		assert.equal(locateIssue(manifest, "99"), undefined);
	});

	test("describePlacement renders human-readable placements", () => {
		const manifest = sample();
		assert.equal(describePlacement(locateIssue(manifest, "30") ?? { kind: "gated" }), "gated");
		assert.equal(describePlacement(locateIssue(manifest, "40") ?? { kind: "human" }), "human");
		assert.equal(
			describePlacement(locateIssue(manifest, "11") ?? { kind: "human" }),
			'batch "U2" (position 2)',
		);
	});
});

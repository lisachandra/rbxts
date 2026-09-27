/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

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
				mergeName: "sandcastle/issue-10",
				name: "U2",
				notes: "order matters",
			},
		],
		serialized: [{ issues: ["11", "12"], name: "R1", reason: "same file" }],
		updatedAt: "2026-01-01T00:00:00.000Z",
		version: 1,
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
			version: 1,
		});
	});

	test("batch labels, member roles, and run-order gates survive a round trip", () => {
		const path = manifestPath("labels.json");
		const manifest: QueueManifest = {
			...emptyQueueManifest(),
			gated: [{ issue: "30", joins: "V", reason: "needs the Studio Sound instance" }],
			sequences: [
				{
					afterMerge: "audio-seam-work",
					issues: ["10", "11"],
					mergeName: "ui-wiring-work",
					name: "U2",
					notes: "ui wiring · one run\n10 shell → 11 data seam",
					roles: { "10": "shell", "11": "data seam" },
					title: "ui wiring",
				},
			],
			updatedAt: "2026-01-01T00:00:00.000Z",
			version: 1,
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
		assert.equal(read.version, 1);
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
			'sequence "U2" (position 2)',
		);
	});
});

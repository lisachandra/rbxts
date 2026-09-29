/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import {
	buildQueueGraph,
	type QueueGraph,
	queueGraphCommentMarker,
	renderQueueAscii,
	renderQueueMarkdown,
	renderQueueMermaid,
} from "./graph.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";
import { computeQueueView } from "./render.js";

registerTestHooks();

function issue(number: string, overrides: Partial<LiveIssue> = {}): LiveIssue {
	return {
		found: true,
		number,
		openBlockers: overrides.openBlockers ?? [],
		ready: overrides.ready ?? true,
		state: overrides.state ?? "OPEN",
		title: overrides.title ?? `Issue ${number}`,
		wayfinder: overrides.wayfinder ?? false,
	};
}

function live(...entries: Array<LiveIssue>): LiveQueueState {
	const issues = new Map<string, LiveIssue>();
	for (const entry of entries) {
		issues.set(entry.number, entry);
	}

	return { issues, readyIssues: [], truncated: false };
}

function manifest(overrides: Partial<QueueManifest> = {}): QueueManifest {
	return {
		...emptyQueueManifest(),
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

/** The graph every rendering test starts from: one payload, three renderers. */
function graphFor(
	overrides: Partial<QueueManifest>,
	state: LiveQueueState = live(),
	gates?: ReadonlyMap<string, string>,
): QueueGraph {
	return buildQueueGraph(computeQueueView(manifest(overrides), state, { gates }), {
		generatedAt: "2026-02-02T00:00:00.000Z",
		repository: { name: "rbxts", owner: "lisachandra" },
	});
}

function edgesOf(graph: QueueGraph, kind: QueueGraph["edges"][number]["kind"]): Array<string> {
	return graph.edges
		.filter((edge) => edge.kind === kind)
		.map((edge) => `${edge.from}>${edge.to}`);
}

describe("queue graph payload", () => {
	test("the spine is one order edge per consecutive batch", () => {
		const graph = graphFor(
			{
				sequences: [
					{ issues: ["1"], name: "A1" },
					{ issues: ["2"], name: "P" },
					{ issues: ["3"], name: "S" },
				],
			},
			live(issue("1"), issue("2"), issue("3")),
		);

		assert.deepEqual(
			graph.nodes.map((node) => node.id),
			["A1", "P", "S"],
		);
		assert.deepEqual(edgesOf(graph, "order"), ["A1>P", "P>S"]);
	});

	test("a gate points from the batch that produces the integration to the one waiting", () => {
		const graph = graphFor(
			{
				sequences: [
					{ issues: ["1"], name: "audio-seam-work" },
					{ after: "audio-seam-work", issues: ["2"], name: "V" },
				],
			},
			live(issue("1"), issue("2")),
		);

		const gate = graph.edges.find((edge) => edge.kind === "gate");
		assert.equal(gate?.from, "audio-seam-work");
		assert.equal(gate?.to, "V");
		assert.equal(gate?.label, "after audio-seam-work");
	});

	test("one batch owns one integration, so a gate has exactly one source", () => {
		const graph = graphFor(
			{
				sequences: [
					{ issues: ["1"], name: "matchmaking-session-work" },
					{ after: "matchmaking-session-work", issues: ["3"], name: "club-system-work" },
				],
			},
			live(issue("1"), issue("3")),
		);

		assert.deepEqual(edgesOf(graph, "gate"), ["matchmaking-session-work>club-system-work"]);
	});

	test("a gate on an integration no batch produces keeps the integration as its source", () => {
		const graph = graphFor(
			{ sequences: [{ after: "elsewhere-work", issues: ["1"], name: "V" }] },
			live(issue("1")),
		);

		const gate = graph.edges.find((edge) => edge.kind === "gate");
		assert.equal(gate?.from, "elsewhere-work");
		assert.equal(gate?.to, "V");
	});

	test("a rule spanning two batches becomes one edge labelled with the rule and its first clause", () => {
		const graph = graphFor(
			{
				sequences: [
					{ issues: ["1"], name: "N1" },
					{ issues: ["2"], name: "C1" },
				],
				serialized: [
					{
						issues: ["1", "2"],
						name: "R9",
						reason: "client prediction seam: all reach nativePrediction.ts",
					},
				],
			},
			live(issue("1"), issue("2")),
		);

		const rule = graph.edges.find((edge) => edge.kind === "rule");
		assert.equal(rule?.from, "N1");
		assert.equal(rule?.to, "C1");
		assert.equal(rule?.label, "R9 client prediction seam");
	});

	test("a rule spanning three batches reads as a chain, and an unnamed rule labels itself", () => {
		const graph = graphFor(
			{
				sequences: [
					{ issues: ["1"], name: "A" },
					{ issues: ["2"], name: "B" },
					{ issues: ["3"], name: "C" },
				],
				serialized: [{ issues: ["1", "2", "3"], reason: "same file" }],
			},
			live(issue("1"), issue("2"), issue("3")),
		);

		assert.deepEqual(edgesOf(graph, "rule"), ["A>B", "B>C"]);
		assert.equal(
			graph.edges.find((edge) => edge.kind === "rule")?.label,
			"serialized: same file",
		);
	});
});

describe("queue graph renderings", () => {
	test("the spine draws solid, the gate dashed with its integration, and each status is classed", () => {
		const graph = graphFor(
			{
				sequences: [
					{
						issues: ["1"],
						name: "audio-seam-work",
						title: "audio seam",
					},
					{ after: "audio-seam-work", issues: ["2"], name: "V" },
				],
			},
			live(issue("1"), issue("2")),
		);

		const mermaid = renderQueueMermaid(graph);
		assert.equal(mermaid.split("\n")[0], "flowchart LR");
		assert.ok(
			mermaid.includes('audio_seam_work["audio-seam-work · audio seam<br/>1 issue · READY"]'),
			mermaid,
		);
		assert.ok(mermaid.includes("  audio_seam_work --> V"), mermaid);
		assert.ok(mermaid.includes("audio_seam_work -.->|after audio-seam-work| V"), mermaid);
		assert.ok(mermaid.includes("classDef ready fill:#1f6feb22,stroke:#1f6feb"), mermaid);
		assert.ok(mermaid.endsWith("  class audio_seam_work,V ready"), mermaid);
	});

	test("a gate on an integration no batch produces is declared as an integration node", () => {
		const graph = graphFor(
			{ sequences: [{ after: "elsewhere-work", issues: ["1"], name: "V" }] },
			live(issue("1")),
		);

		const mermaid = renderQueueMermaid(graph);
		assert.ok(mermaid.includes('elsewhere_work(["elsewhere-work<br/>integration"])'), mermaid);
		assert.ok(mermaid.includes("elsewhere_work -.->|after elsewhere-work| V"), mermaid);
	});

	test("a rule draws thick and a cross-batch blocker draws dashed", () => {
		const graph = graphFor(
			{
				sequences: [
					{ issues: ["1"], name: "N1" },
					{ issues: ["2"], name: "C1" },
				],
				serialized: [{ issues: ["1", "2"], name: "R9", reason: "same seam" }],
			},
			live(issue("1"), issue("2", { openBlockers: ["1"] })),
		);

		const mermaid = renderQueueMermaid(graph);
		assert.ok(mermaid.includes("N1 ==>|R9 same seam| C1"), mermaid);
		assert.ok(mermaid.includes("N1 -.->|blocked by #1| C1"), mermaid);
	});

	test("a rule reason with braces and pipes cannot break the edge label", () => {
		const graph = graphFor(
			{
				sequences: [
					{ issues: ["1"], name: "V" },
					{ issues: ["2"], name: "C4" },
				],
				serialized: [
					{
						issues: ["1", "2"],
						name: "R2",
						reason: "{types} seam renames | 292 reads it",
					},
				],
			},
			live(issue("1"), issue("2")),
		);

		const mermaid = renderQueueMermaid(graph);
		assert.ok(
			mermaid.includes("V ==>|R2 #123;types#125; seam renames #124; 292 reads it| C4"),
			mermaid,
		);
	});

	test("--issues expands a batch into its members and chains them in run order", () => {
		const graph = graphFor(
			{ sequences: [{ issues: ["1", "2"], name: "A1" }] },
			live(issue("1"), issue("2")),
		);

		const mermaid = renderQueueMermaid(graph, { issues: true });
		assert.ok(mermaid.includes('  subgraph A1["A1<br/>2 issues · READY"]'), mermaid);
		assert.ok(mermaid.includes('    A1_n_1["#1 Issue 1"]'), mermaid);
		assert.ok(mermaid.includes("  A1_n_1 --> A1_n_2"), mermaid);
		assert.ok(mermaid.endsWith("  class A1_n_1,A1_n_2 ready"), mermaid);
	});

	test("the Markdown page leads with the marker and carries no render timestamp", () => {
		const graph = graphFor({ sequences: [{ issues: ["1"], name: "A1" }] }, live(issue("1")));

		const page = renderQueueMarkdown(graph);
		assert.ok(page.startsWith(`${queueGraphCommentMarker}\n`), page);
		assert.ok(page.includes("## Queue run order"), page);
		assert.ok(page.includes("1 batch · 1 READY · manifest updated"), page);
		assert.ok(page.includes("```mermaid\nflowchart LR"), page);
		assert.ok(page.includes("**How to read it**"), page);
		assert.ok(
			!page.includes(graph.generatedAt),
			"--write output must not embed the render time",
		);
		assert.ok(page.includes("`sandcastle queue graph`"), page);
	});

	test("the Markdown page lists the gated and human buckets verbatim", () => {
		const graph = graphFor(
			{ gated: [{ issue: "7", joins: "P", reason: "needs progression first" }] },
			live(issue("7", { ready: false })),
		);

		const page = renderQueueMarkdown(graph);
		assert.ok(page.includes("**Gated** (joins a batch once the condition clears)"), page);
		assert.ok(page.includes("- #7 → P — needs progression first"), page);
	});

	test("the terminal preview numbers the run order and keeps the other edges apart", () => {
		const graph = graphFor(
			{
				sequences: [
					{
						issues: ["1"],
						name: "A1",
						title: "audio seam",
					},
					{ after: "audio-seam-work", issues: ["2"], name: "V" },
				],
			},
			live(issue("1"), issue("2")),
		);

		const preview = renderQueueAscii(graph);
		assert.equal(preview.split("\n")[0], "── Sandcastle queue graph (lisachandra/rbxts) ──");
		assert.ok(preview.includes("  Manifest updated: 2026-01-01T00:00:00.000Z"), preview);
		assert.match(
			preview,
			/^ {2}#1 {3}✓ READY {2}A1 · audio seam +1 issue\(s\) sandcastle\/integration\/A1$/mu,
		);
		assert.ok(preview.includes("  Edges (run order is the list above):"), preview);
		assert.ok(preview.includes("gate     audio-seam-work → V after audio-seam-work"), preview);
	});
});

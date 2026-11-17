import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { registerTestHooks } from "../test-helpers.js";
import {
	buildQueueGraph,
	laneRanks,
	type QueueGraph,
	queueGraphCommentMarker,
	type QueueGraphLanes,
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

/** Every issue a manifest references, as live state, so nothing reads as not scanned. */
function stateFor(overrides: Partial<QueueManifest>): LiveQueueState {
	const numbers = new Set<string>();
	for (const sequence of overrides.sequences ?? []) {
		for (const number of sequence.issues) {
			numbers.add(number);
		}
	}

	for (const entry of overrides.gated ?? []) {
		numbers.add(entry.issue);
	}

	return live(...[...numbers].map((number) => issue(number)));
}

/** The graph a parallel rendering test starts from: the same view plus `queue.parallel`. */
function graphWithLanes(
	overrides: Partial<QueueManifest>,
	parallel: number,
	profiles: ReadonlyArray<string>,
): QueueGraph {
	return buildQueueGraph(computeQueueView(manifest(overrides), stateFor(overrides)), {
		generatedAt: "2026-02-02T00:00:00.000Z",
		parallel,
		profiles,
		repository: { name: "rbxts", owner: "lisachandra" },
	});
}

/** The lane payload a spec asserts on, failing loudly when the graph decided not to draw lanes. */
function lanesOf({ lanes }: QueueGraph): QueueGraphLanes {
	assert.ok(lanes !== undefined, "expected the graph to carry lanes");
	return lanes;
}

/** A three-batch manifest with no constraint between any pair. */
const unconstrained: Partial<QueueManifest> = {
	sequences: [
		{ issues: ["1"], name: "A" },
		{ issues: ["2"], name: "B" },
		{ issues: ["3"], name: "C" },
	],
};

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

describe("queue graph lanes", () => {
	test("a serial queue carries no lanes at all", () => {
		const graph = graphWithLanes(unconstrained, 1, ["sonnet", "flash"]);

		assert.equal(graph.lanes, undefined);
	});

	test("a parallel queue with one batch carries no lanes: there is no second batch to share", () => {
		const graph = graphWithLanes({ sequences: [{ issues: ["1"], name: "A" }] }, 3, ["sonnet"]);

		assert.equal(graph.lanes, undefined);
	});

	test("unconstrained batches share rank 0, and their slots are the fire order", () => {
		const lanes = lanesOf(graphWithLanes(unconstrained, 2, ["sonnet", "flash"]));

		assert.deepEqual(lanes.ranks, [{ batches: ["A", "B", "C"], index: 0 }]);
		assert.deepEqual(lanes.slots, [
			{ batch: "A", slot: 0 },
			{ batch: "B", slot: 1 },
		]);
		assert.deepEqual(lanes.profiles, ["sonnet", "flash"]);
	});

	test("an unmet after gate is a barrier: the consumer lands one rank later", () => {
		const lanes = lanesOf(
			graphWithLanes(
				{
					sequences: [
						{ issues: ["1"], name: "producer" },
						{ after: "producer", issues: ["2"], name: "consumer" },
					],
				},
				2,
				["sonnet", "flash"],
			),
		);

		assert.deepEqual(lanes.ranks, [
			{ batches: ["producer"], index: 0 },
			{ batches: ["consumer"], index: 1 },
		]);
	});

	test("a serialization rule is a barrier even though neither batch waits on the other", () => {
		const lanes = lanesOf(
			graphWithLanes(
				{
					sequences: [
						{ issues: ["1"], name: "A" },
						{ issues: ["2"], name: "B" },
					],
					serialized: [{ issues: ["1", "2"], name: "R9", reason: "same seam" }],
				},
				2,
				["sonnet"],
			),
		);

		assert.deepEqual(lanes.ranks, [
			{ batches: ["A"], index: 0 },
			{ batches: ["B"], index: 1 },
		]);
	});

	test("a live blocker is not a barrier: the dispatcher reads it as GATED, not as a lane", () => {
		const graph = buildQueueGraph(
			computeQueueView(
				manifest({
					sequences: [
						{ issues: ["1"], name: "A" },
						{ issues: ["2"], name: "B" },
					],
				}),
				live(issue("1"), issue("2", { openBlockers: ["1"] })),
			),
			{
				generatedAt: "2026-02-02T00:00:00.000Z",
				parallel: 2,
				profiles: ["sonnet"],
				repository: { name: "rbxts", owner: "lisachandra" },
			},
		);

		assert.deepEqual(edgesOf(graph, "blocker"), ["A>B"]);
		assert.deepEqual(lanesOf(graph).ranks, [{ batches: ["A", "B"], index: 0 }]);
	});

	test("run order is not a barrier either: adjacent batches still share a rank", () => {
		const lanes = lanesOf(graphWithLanes(unconstrained, 3, ["sonnet"]));

		assert.equal(lanes.ranks.length, 1);
	});

	test("ranks are the longest path, so a chain of gates counts every link", () => {
		const lanes = lanesOf(
			graphWithLanes(
				{
					sequences: [
						{ issues: ["1"], name: "one" },
						{ after: "one", issues: ["2"], name: "two" },
						{ after: "two", issues: ["3"], name: "three" },
					],
				},
				3,
				["sonnet"],
			),
		);

		assert.deepEqual(lanes.ranks, [
			{ batches: ["one"], index: 0 },
			{ batches: ["two"], index: 1 },
			{ batches: ["three"], index: 2 },
		]);
	});

	test("a gate on an integration no batch produces is still a wait, so its consumer ranks later", () => {
		const lanes = lanesOf(
			graphWithLanes(
				{
					sequences: [
						{ issues: ["1"], name: "A" },
						{ after: "elsewhere-work", issues: ["2"], name: "V" },
					],
				},
				2,
				["sonnet"],
			),
		);

		assert.deepEqual(lanes.ranks, [
			{ batches: ["A"], index: 0 },
			{ batches: ["V"], index: 1 },
		]);
	});

	test("a cyclic after chain ranks each batch once, in one rank, instead of recursing forever", () => {
		const ranks = laneRanks(
			[{ after: "B", id: "A" } as never, { after: "A", id: "B" } as never],
			[
				{ from: "B", kind: "gate", to: "A" },
				{ from: "A", kind: "gate", to: "B" },
			] as never,
		);

		/*
		 * One rank at index 0, not one rank at index 1: a cycle means neither batch ever fires, so
		 * counting the back edge as a wait would rank the deadlock behind a barrier that does not exist
		 * and shift every downstream rank with it.
		 */
		assert.deepEqual(ranks, [{ batches: ["A", "B"], index: 0 }]);
	});

	test("a cycle's members do not drag a batch that only waits on the cycle into their rank", () => {
		const ranks = laneRanks(
			[
				{ after: "B", id: "A" } as never,
				{ after: "A", id: "B" } as never,
				{ after: "A", id: "C" } as never,
			],
			[
				{ from: "B", kind: "gate", to: "A" },
				{ from: "A", kind: "gate", to: "B" },
				{ from: "A", kind: "gate", to: "C" },
			] as never,
		);

		assert.deepEqual(ranks, [
			{ batches: ["A", "B"], index: 0 },
			{ batches: ["C"], index: 1 },
		]);
	});

	test("the Mermaid diagram groups each rank into its own subgraph", () => {
		const graph = graphWithLanes(
			{
				sequences: [
					{ issues: ["1"], name: "A" },
					{ issues: ["2"], name: "B" },
					{ after: "A", issues: ["3"], name: "C" },
				],
			},
			2,
			["sonnet", "flash"],
		);

		const mermaid = renderQueueMermaid(graph);
		assert.ok(
			mermaid.includes('  subgraph rank_0["rank 1 · A lane 1 sonnet, B lane 2 flash"]'),
			mermaid,
		);
		assert.ok(mermaid.includes("    A["), mermaid);
		assert.ok(mermaid.includes("    B["), mermaid);
		assert.ok(
			mermaid.includes('  subgraph rank_1["rank 2 · lanes 1-2 sonnet, flash"]'),
			mermaid,
		);
		assert.ok(mermaid.includes("    C["), mermaid);
	});

	test("--issues keeps the composition diagram and leaves the ranks to the page", () => {
		const graph = graphWithLanes(unconstrained, 2, ["sonnet", "flash"]);

		const mermaid = renderQueueMermaid(graph, { issues: true });
		assert.ok(!mermaid.includes("subgraph rank_0"), mermaid);
		assert.ok(mermaid.includes('  subgraph A["A<br/>1 issue · READY"]'), mermaid);
	});

	test("the Markdown page states which lane runs each profile and that only rank 1 is fixed", () => {
		const graph = graphWithLanes(unconstrained, 2, ["sonnet", "flash"]);

		const page = renderQueueMarkdown(graph);
		assert.ok(page.includes("**Parallel lanes**"), page);
		assert.ok(page.includes("- rank 1: A, B, C (A in lane 1, B in lane 2)"), page);
		assert.ok(page.includes("lane 1 runs `sonnet`; lane 2 runs `flash`"), page);
		assert.ok(page.includes("Only rank 1's pairing is fixed"), page);
	});

	test("a parallel queue with no catalog says so instead of naming a profile", () => {
		const graph = graphWithLanes(unconstrained, 2, []);

		const mermaid = renderQueueMermaid(graph);
		assert.ok(mermaid.includes('subgraph rank_0["rank 1 · no agents.catalog"]'), mermaid);
		assert.ok(!mermaid.includes("agents.default"), mermaid);

		const page = renderQueueMarkdown(graph);
		assert.ok(page.includes("`agents.catalog` is empty"), page);
		assert.ok(!page.includes("lane 1 runs"), page);

		const preview = renderQueueAscii(graph);
		assert.ok(preview.includes("no profile per lane"), preview);
	});

	test("the terminal preview lists the ranks before the edge list", () => {
		const graph = graphWithLanes(
			{
				sequences: [
					{ issues: ["1"], name: "A" },
					{ after: "A", issues: ["2"], name: "B" },
				],
			},
			2,
			["sonnet", "flash"],
		);

		const preview = renderQueueAscii(graph);
		const lanesAt = preview.indexOf("  Parallel lanes:");
		const edgesAt = preview.indexOf("  Edges (run order is the list above):");
		assert.ok(lanesAt !== -1, preview);
		assert.ok(edgesAt !== -1, preview);
		assert.ok(lanesAt < edgesAt, preview);
		assert.ok(preview.includes("    rank 1: A (A in lane 1)"), preview);
		assert.ok(preview.includes("    rank 2: B"), preview);
		assert.ok(preview.includes("    lane profiles: 1=sonnet 2=flash"), preview);
	});

	test("a serial page is byte-identical whether or not profiles are offered", () => {
		const serial = renderQueueMarkdown(graphFor(unconstrained, stateFor(unconstrained)));

		const page = renderQueueMarkdown(graphWithLanes(unconstrained, 1, ["sonnet"]));
		assert.equal(page, serial);
	});
});

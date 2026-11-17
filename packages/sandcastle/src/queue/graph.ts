/*
 * Queue graph: one pure payload behind both human renderings of the queue.
 *
 * `queue list` renders a flat table, which cannot show batch composition, gate kind, or run order —
 * the three things a reader needs to trust the schedule. This module derives the graph once —
 * batches as nodes, `order` / `gate` / `rule` / `blocker` as edges — and both the Mermaid text
 * emitted by `queue graph` and the xyflow page served by `queue serve` consume it, so the two
 * renderings cannot drift apart.
 *
 * Pure: no I/O and no clock. Live GitHub state arrives through the `QueueView` the caller already
 * built, and the repository slug and render timestamp are options.
 */

import { integrationBranch } from "../integration/manifest.js";
import type { LiveIssue } from "./live.js";
import type { QueueManifest } from "./manifest.js";
import type { QueueSequenceView, QueueView } from "./render.js";

/** Node lifecycle. `landed` refines the view's GATED for a batch whose members have all closed. */
export type QueueGraphNodeStatus = "EMPTY" | "GATED" | "READY" | "landed";

/** Edge kinds, in the order both renderers print them: the spine first, the constraints after. */
export type QueueGraphEdgeKind = "gate" | "rule" | "order" | "blocker";

/** The renderings `queue graph` can print. */
export type QueueGraphFormat = "json" | "ascii" | "mermaid";

export interface QueueGraphIssue {
	found: boolean;
	number: string;
	/** Open blockers, including ones satisfied by position inside this same batch. */
	openBlockers: Array<string>;
	ready: boolean;
	/** Role phrase from the batch's `roles` map, e.g. "shell + ScreenHost". */
	role: string | undefined;
	state: LiveIssue["state"];
	title: string;
}

export interface QueueGraphNode {
	/** Integration this batch waits for before it may fire; the label of its `gate` edge. */
	after: string | undefined;
	/** Integration branch the batch's pull request targets: `sandcastle/integration/<name>`. */
	branch: string;
	/** Batch name, e.g. "U2"; also the node id. */
	id: string;
	/** Members in run order. */
	issues: Array<QueueGraphIssue>;
	name: string;
	/** One entry per `notes` line. */
	notes: Array<string>;
	/** Why the batch is GATED, worded exactly as `queue list` words it. */
	reasons: Array<string>;
	/** The manifest's per-issue role map, kept verbatim for the web detail panel. */
	roles: undefined | Record<string, string>;
	status: QueueGraphNodeStatus;
	/** Short human label, e.g. "ui wiring". */
	title: string | undefined;
}

export interface QueueGraphEdge {
	/** Extra context the web detail panel shows; both renderers print `label` instead. */
	detail: string | undefined;
	/** Producing batch name — for a `blocker` edge, the batch that owns the blocker. */
	from: string;
	/** Issue the edge starts at, when it comes from one issue pair (blocker edges). */
	fromIssue: string | undefined;
	kind: QueueGraphEdgeKind;
	/** Short human label; both renderers show this instead of re-deriving the meaning. */
	label: string;
	/** Consuming batch name. */
	to: string;
	/** Issue the edge lands on, when it comes from one issue pair (blocker edges). */
	toIssue: string | undefined;
}

export interface QueueGraph {
	edges: Array<QueueGraphEdge>;
	/** Gated issues that join a batch once their condition clears. */
	gated: QueueView["gated"];
	/** Set by the caller: only the JSON payload and the sticky comment expose it. */
	generatedAt: string;
	/** Issues that are never queued; they need a human decision session. */
	human: QueueView["human"];
	/**
	 * Parallel dispatch ranks, present only when the repository runs more than one batch at a time.
	 *
	 * Absent for a serial queue on purpose: a serial run has no lanes, and drawing them would
	 * describe a schedule the dispatcher will never produce.
	 */
	lanes?: QueueGraphLanes;
	nodes: Array<QueueGraphNode>;
	/** `owner/name`, so a rendering can link the issues it names. */
	repository: { name: string; owner: string };
	/** Serialization rules, for the legend; the `rule` edges label themselves from these. */
	rules: QueueManifest["serialized"];
	/** Manifest stamp the graph was built from; stable per manifest, unlike `generatedAt`. */
	updated: string;
}

/** One parallel rank: batches that may be in flight at the same time. */
export interface QueueLaneRank {
	/** Batch names, in run order within the rank. */
	batches: Array<string>;
	/** Zero-based rank; every batch in it may run at once. */
	index: number;
}

/** The parallel-lane view of a graph, present only when `queue.parallel` allows it. */
export interface QueueGraphLanes {
	/**
	 * Profile name per lane slot, in slot order.
	 *
	 * Empty means `agents.catalog` is empty, in which case `queue run --parallel` refuses rather
	 * than falling back to `agents.default` — so the graph names no profile either, and the render
	 * says which prerequisite is missing instead of promising a model no lane would run.
	 */
	profiles: Array<string>;
	/** Ranks in dispatch order. */
	ranks: Array<QueueLaneRank>;
	/**
	 * Rank 0's batches paired with the slot each would take.
	 *
	 * Exact, unlike later ranks: slots are handed out in fire order, so the first `parallel`
	 * batches occupy slots `0..parallel-1` and nothing else can interleave with them. Which slot
	 * frees first after that is a runtime fact, so later ranks name their slot set rather than
	 * pretending to know.
	 */
	slots: Array<{ batch: string; slot: number }>;
}

export interface QueueGraphOptions {
	generatedAt: string;
	/** Parallel limit from `queue.parallel`; `<= 1` (or absent) leaves `lanes` unset. */
	parallel?: number;
	/**
	 * Profile name per lane slot, from `agents.catalog`.
	 *
	 * The caller resolves these with `profileForLane`, the same function the pool uses, so the plan
	 * and the dispatcher cannot disagree about which model a slot runs — including the wrap when
	 * the catalog is shorter than the parallel limit.
	 */
	profiles?: ReadonlyArray<string>;
	repository: { name: string; owner: string };
}

/**
 * - The leading clause of a reason, for edge labels that have no room for the whole sentence.
 * - @param text - Rule or gate reason.
 * - @returns Text up to the first separator, or a word-boundary cut at 40 characters.
 */
function firstClause(text: string): string {
	const cut = text.split(/[:,\u2014]/u)[0]?.trim() ?? "";
	if (cut.length <= 40) {
		return cut;
	}

	const clipped = cut.slice(0, 40);
	const boundary = clipped.lastIndexOf(" ");
	return `${(boundary === -1 ? clipped : clipped.slice(0, boundary)).trimEnd()}\u2026`;
}

/** `R9 client prediction seam` — the rule name plus the clause that says what the rule is about. */
function ruleLabel(name: string | undefined, reason: string): string {
	const head = firstClause(reason);
	return name === undefined ? `serialized: ${head}` : `${name} ${head}`;
}

/** One entry per non-empty `notes` line, the same split `queue list` renders. */
function noteLines(notes: string | undefined): Array<string> {
	return (notes ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

function graphIssue(
	issue: QueueSequenceView["issues"][number],
	roles: undefined | Record<string, string>,
): QueueGraphIssue {
	return {
		found: issue.found,
		number: issue.number,
		openBlockers: issue.openBlockers,
		ready: issue.ready,
		role: roles?.[issue.number],
		state: issue.state,
		title: issue.title,
	};
}

/**
 * - Whether every member has closed, which `queue list` can only report as GATED reasons.
 * - @param issues - Members as the graph carries them.
 * - @returns `true` when there is at least one member and all of them are CLOSED and found.
 */
function isLanded(issues: ReadonlyArray<QueueGraphIssue>): boolean {
	return issues.length > 0 && issues.every((issue) => issue.found && issue.state === "CLOSED");
}

function nodeFor(sequence: QueueSequenceView): QueueGraphNode {
	const issues = sequence.issues.map((issue) => graphIssue(issue, sequence.roles));
	return {
		after: sequence.after,
		branch: integrationBranch(sequence.name),
		id: sequence.name,
		issues,
		name: sequence.name,
		notes: noteLines(sequence.notes),
		reasons: sequence.reasons,
		roles: sequence.roles,
		status: isLanded(issues) ? "landed" : sequence.status,
		title: sequence.title,
	};
}

/** The dispatch spine: `sequences[]` array adjacency, one edge per consecutive pair. */
function orderEdges(nodes: ReadonlyArray<QueueGraphNode>): Array<QueueGraphEdge> {
	const edges: Array<QueueGraphEdge> = [];
	for (let index = 1; index < nodes.length; index++) {
		const from = nodes[index - 1];
		const to = nodes[index];
		if (from === undefined || to === undefined) {
			continue;
		}

		edges.push({
			detail: undefined,
			from: from.id,
			fromIssue: undefined,
			kind: "order",
			label: "run order",
			to: to.id,
			toIssue: undefined,
		});
	}

	return edges;
}

/**
 * - Gate edges: a batch waiting on an integration points at every batch that produces it.
 * - @param nodes - Batch nodes in run order.
 * - @returns One `gate` edge per (producing batch, waiting batch) pair, labelled `after
 *   <integration>`.
 * - @remarks A gate whose integration no batch in the manifest produces keeps the integration name as
 *   its source, so a wait on something composed elsewhere stays visible.
 */
function gateEdges(nodes: ReadonlyArray<QueueGraphNode>): Array<QueueGraphEdge> {
	const edges: Array<QueueGraphEdge> = [];
	for (const node of nodes) {
		if (node.after === undefined) {
			continue;
		}

		const producers = nodes.filter((candidate) => candidate.name === node.after);
		const sources = producers.length === 0 ? [undefined] : producers;
		for (const producer of sources) {
			edges.push({
				detail:
					producer === undefined
						? `${node.name} waits on integration ${node.after}, which no batch here produces`
						: `${producer.name} produces integration ${node.after}`,
				from: producer?.id ?? node.after,
				fromIssue: undefined,
				kind: "gate",
				label: `after ${node.after}`,
				to: node.id,
				toIssue: undefined,
			});
		}
	}

	return edges;
}

/**
 * - Blocker edges: a live `blocked-by` that crosses batch boundaries.
 * - @param nodes - Batch nodes in run order.
 * - @returns One edge per (blocking batch, blocked batch) pair, labelled `blocked by #<n>`.
 * - @remarks A blocker inside the blocked issue's own batch is satisfied by position, so it never
 *   becomes an edge — the same rule `computeQueueView` applies before it calls a batch GATED.
 */
function blockerEdges(nodes: ReadonlyArray<QueueGraphNode>): Array<QueueGraphEdge> {
	const owner = new Map<string, string>();
	for (const node of nodes) {
		for (const issue of node.issues) {
			owner.set(issue.number, node.id);
		}
	}

	const edges: Array<QueueGraphEdge> = [];
	const seen = new Set<string>();
	for (const node of nodes) {
		for (const issue of node.issues) {
			for (const blocker of issue.openBlockers) {
				const from = owner.get(blocker);
				if (from === undefined || from === node.id) {
					continue;
				}

				const key = `${from}>${node.id}#${issue.number}`;
				if (seen.has(key)) {
					continue;
				}

				seen.add(key);
				edges.push({
					detail: `#${blocker} is an open blocker of #${issue.number}`,
					from,
					fromIssue: blocker,
					kind: "blocker",
					label: `blocked by #${blocker}`,
					to: node.id,
					toIssue: issue.number,
				});
			}
		}
	}

	return edges;
}

/**
 * - Rule edges: a serialization rule spanning two batches.
 * - @param nodes - Batch nodes in run order.
 * - @param rules - The manifest's `serialized` array.
 * - @returns One edge per consecutive batch pair a rule spans, so a three-batch rule reads as a
 *   chain.
 * - @remarks Direction is run order, not precedence: a rule means the two batches must never be in
 *   flight together, so there is no earlier or later end to point at.
 */
function ruleEdges(
	nodes: ReadonlyArray<QueueGraphNode>,
	rules: QueueManifest["serialized"],
): Array<QueueGraphEdge> {
	const position = new Map<string, number>();
	for (const [index, node] of nodes.entries()) {
		for (const issue of node.issues) {
			position.set(issue.number, index);
		}
	}

	const edges: Array<QueueGraphEdge> = [];
	for (const rule of rules) {
		const spanned = new Set<number>();
		for (const issue of rule.issues) {
			const index = position.get(issue);
			if (index !== undefined) {
				spanned.add(index);
			}
		}

		const ordered = [...spanned].sort((left, right) => left - right);
		for (let index = 1; index < ordered.length; index++) {
			const from = nodes[ordered[index - 1] ?? -1];
			const to = nodes[ordered[index] ?? -1];
			if (from === undefined || to === undefined) {
				continue;
			}

			const members = rule.issues.map((issue) => `#${issue}`).join(", ");
			edges.push({
				detail: `${members} — ${rule.reason}`,
				from: from.id,
				fromIssue: undefined,
				kind: "rule",
				label: ruleLabel(rule.name, rule.reason),
				to: to.id,
				toIssue: undefined,
			});
		}
	}

	return edges;
}

/**
 * - Builds the shared queue graph: batches as nodes, order/gate/rule/blocker as edges.
 * - @param view - The live queue view, which already carries every issue the graph needs.
 * - @param options - Render timestamp and repository slug: the I/O the caller owns.
 * - @returns The payload behind both `queue graph` and the `queue serve` page.
 * - @example
 *
 *   ```ts
 *   const graph = buildQueueGraph(liveView(false), {
 *   	generatedAt: new Date().toISOString(),
 *   	repository: { name: "rbxts", owner: "lisachandra" },
 *   });
 *   graph.nodes.map((node) => node.id); // ["A1", "P", "S", ...]
 *   ```
 */
export function buildQueueGraph(view: QueueView, options: QueueGraphOptions): QueueGraph {
	const nodes = view.sequences.map((sequence) => nodeFor(sequence));
	const edges = [
		...orderEdges(nodes),
		...gateEdges(nodes),
		...ruleEdges(nodes, view.rules),
		...blockerEdges(nodes),
	];
	const graph: QueueGraph = {
		edges,
		gated: view.gated,
		generatedAt: options.generatedAt,
		human: view.human,
		nodes,
		repository: options.repository,
		rules: view.rules,
		updated: view.updated,
	};
	const lanes = laneSection(nodes, edges, options);
	if (lanes !== undefined) {
		graph.lanes = lanes;
	}

	return graph;
}

/** Edge kinds that stop two batches being in flight together, as `selectNextBatch` decides. */
const barrierKinds: ReadonlySet<QueueGraphEdgeKind> = new Set<QueueGraphEdgeKind>(["gate", "rule"]);

/**
 * - Groups batches into the ranks a parallel dispatcher could actually run together.
 * - @param nodes - The graph's batch nodes, in manifest order.
 * - @param edges - Every edge the graph carries; only `gate` and `rule` rank.
 * - @returns One rank per dispatch step, each listing its batches in manifest order.
 * - @remarks The rule set is `selectNextBatch`'s, not the web layout's: an unmet `after` gate and an
 *   `R<n>` violation are the only things that keep two batches apart. Run order, member position,
 *   and live blockers are not barriers — a batch whose only obstacle is a live blocker is still
 *   READY-adjacent for scheduling purposes, and treating the arrow as a lane would describe a wait
 *   the dispatcher never performs.
 *
 *   A gate on an integration no batch produces still ranks its consumer, because the wait is real
 *   even when the producer is not in this manifest.
 */
export function laneRanks(
	nodes: ReadonlyArray<QueueGraphNode>,
	edges: ReadonlyArray<QueueGraphEdge>,
): Array<QueueLaneRank> {
	/** Batch id -> the batches it waits on through a barrier edge. */
	const waitsOn = new Map<string, Array<string>>();
	for (const node of nodes) {
		waitsOn.set(node.id, []);
	}

	for (const edge of edges) {
		if (!barrierKinds.has(edge.kind)) {
			continue;
		}

		waitsOn.get(edge.to)?.push(edge.from);
	}

	/*
	 * An `after` cycle is not drift today, so a manifest that contains one must still render — and
	 * "must not hang" is the whole requirement on it. Recursion would hang, and a back edge counted as
	 * a barrier would rank the cycle's members differently depending on which one the walk started
	 * from. Both are wrong about the schedule: batches that wait on each other never fire at all, so
	 * they belong in one rank, unordered among themselves.
	 */
	const group = cycleGroups(nodes, waitsOn);

	/** Group -> the ids it waits on. A self-edge or an intra-group edge is not a wait. */
	const groupWaitsOn = new Map<string, Set<string>>();
	for (const node of nodes) {
		const own = group.get(node.id) ?? node.id;
		const waits = groupWaitsOn.get(own);
		for (const dependency of waitsOn.get(node.id) ?? []) {
			if (group.get(dependency) === own) {
				continue;
			}

			if (waits === undefined) {
				groupWaitsOn.set(own, new Set([dependency]));
			} else {
				waits.add(dependency);
			}
		}
	}

	const computed = new Map<string, number>();
	const visiting = new Set<string>();

	const rankOf = (own: string): number => {
		const known = computed.get(own);
		if (known !== undefined) {
			return known;
		}

		if (visiting.has(own)) {
			/*
			 * Unreachable by construction: `cycleGroups` collapses every mutually-reachable set, so the
			 * graph the walk sees is a condensation and has no cycle left to re-enter. Throwing rather
			 * than returning a rank keeps that invariant honest — a silent 0 would rank a real cycle as
			 * "runs first" and hide the bug in the drawing instead of in this function.
			 */
			throw new Error(
				`queue graph: rank walk re-entered ${own}, so the cycle groups were not a condensation`,
			);
		}

		visiting.add(own);
		let rank = 0;
		for (const dependency of groupWaitsOn.get(own) ?? []) {
			const producer = group.get(dependency);
			// An external integration is a wait with no producer left in the manifest.
			rank = Math.max(rank, producer === undefined ? 1 : rankOf(producer) + 1);
		}

		visiting.delete(own);
		computed.set(own, rank);
		return rank;
	};

	const byRank = new Map<number, QueueLaneRank>();
	for (const node of nodes) {
		const index = rankOf(group.get(node.id) ?? node.id);
		const existing = byRank.get(index);
		if (existing === undefined) {
			byRank.set(index, { batches: [node.id], index });
			continue;
		}

		existing.batches.push(node.id);
	}

	return [...byRank.values()].sort((left, right) => left.index - right.index);
}

/**
 * - The batches that can never be ordered against each other, as id -> group.
 * - @param nodes - Batch nodes, in manifest order.
 * - @param waitsOn - Barrier edges, as "this batch waits for these".
 * - @returns A group id per batch; batches outside any cycle keep their own id.
 * - @remarks Reachability closure rather than a strongly-connected-components algorithm: a queue has
 *   tens of batches, and "they can reach each other" is the definition of the property that matters
 *   here, in a few lines a reader can check.
 */
function cycleGroups(
	nodes: ReadonlyArray<QueueGraphNode>,
	waitsOn: ReadonlyMap<string, ReadonlyArray<string>>,
): Map<string, string> {
	const reach = new Map<string, Set<string>>();
	for (const node of nodes) {
		const seen = new Set<string>();
		const stack = [...(waitsOn.get(node.id) ?? [])];
		while (stack.length > 0) {
			const next = stack.pop();
			if (next === undefined || seen.has(next)) {
				continue;
			}

			seen.add(next);
			stack.push(...(waitsOn.get(next) ?? []));
		}

		reach.set(node.id, seen);
	}

	const groups = new Map<string, string>();
	for (const node of nodes) {
		if (groups.has(node.id)) {
			continue;
		}

		groups.set(node.id, node.id);
		for (const other of nodes) {
			if (other.id === node.id || groups.has(other.id)) {
				continue;
			}

			if (
				reach.get(node.id)?.has(other.id) === true &&
				reach.get(other.id)?.has(node.id) === true
			) {
				groups.set(other.id, node.id);
			}
		}
	}

	return groups;
}

/**
 * - The lane section, or nothing when the queue runs one batch at a time.
 * - @param nodes - Batch nodes.
 * - @param edges - Graph edges.
 * - @param options - Caller options; `parallel` and `profiles` decide whether lanes are drawn.
 * - @returns The lanes payload, or `undefined` to leave `QueueGraph.lanes` unset.
 * - @remarks Two batches is the minimum a lane view can say anything about: with fewer, every rank is
 *   rank 0 and the section would restate the node list. `parallel <= 1` is a serial dispatch by
 *   definition, so it has no lanes at all.
 */
function laneSection(
	nodes: ReadonlyArray<QueueGraphNode>,
	edges: ReadonlyArray<QueueGraphEdge>,
	options: QueueGraphOptions,
): undefined | QueueGraphLanes {
	const parallel = options.parallel ?? 1;
	if (parallel <= 1 || nodes.length < 2) {
		return undefined;
	}

	const ranks = laneRanks(nodes, edges);
	const opening = ranks[0]?.batches ?? [];
	return {
		/* Already one name per slot: the caller asks `profileForLane` rather than slicing the catalog. */
		profiles: [...(options.profiles ?? [])].slice(0, parallel),
		ranks,
		slots: opening.slice(0, parallel).map((batch, slot) => ({ batch, slot })),
	};
}

/** Mermaid ids cannot carry punctuation, and an id may not start with a digit. */
function mermaidId(raw: string): string {
	const cleaned = raw.replaceAll(/[^0-9A-Za-z_]/gu, "_");
	return cleaned === "" || /^[0-9]/u.test(cleaned) ? `n_${cleaned}` : cleaned;
}

/** Issue node id inside an expanded batch, e.g. `A1_409`. */
function issueNodeId(batch: string, issue: string): string {
	return `${mermaidId(batch)}_${mermaidId(issue)}`;
}

/**
 * Mermaid labels are HTML-ish, so metacharacters have to become entities.
 *
 * Ampersand, quote, and angle brackets would parse as HTML; a pipe would end an edge label early
 * and braces would open a node shape (the R2 rule reason carries a braces path, which once emitted
 * a raw brace inside pipes and Mermaid failed with got DIAMOND_START).
 */
function escapeLabel(text: string): string {
	return text
		.replaceAll("&", "#amp;")
		.replaceAll('"', "#quot;")
		.replaceAll("<", "#lt;")
		.replaceAll(">", "#gt;")
		.replaceAll("|", "#124;")
		.replaceAll("{", "#123;")
		.replaceAll("}", "#125;");
}

/** `A1 · audio seam<br/>1 issue · READY` */
function mermaidNodeLabel(node: QueueGraphNode): string {
	const title = node.title === undefined ? "" : ` · ${node.title}`;
	const count = node.issues.length === 1 ? "1 issue" : `${node.issues.length} issues`;
	const head = escapeLabel(node.name + title);
	return `${head}<br/>${count} · ${node.status}`;
}

/** `#409 unify the sound emit seam — unify the sound emit seam (missing ready-for-agent)` */
function mermaidIssueLabel(issue: QueueGraphIssue): string {
	const marks: Array<string> = [];
	if (issue.state === "CLOSED") {
		marks.push("CLOSED");
	} else if (!issue.found) {
		marks.push("not found");
	} else if (!issue.ready) {
		marks.push("missing ready-for-agent");
	}

	if (issue.openBlockers.length > 0) {
		const blockers = issue.openBlockers.map((number) => `#${number}`).join(" ");
		marks.push(`blocked by ${blockers}`);
	}

	const suffix = marks.length === 0 ? "" : ` (${marks.join(" · ")})`;
	const role = issue.role === undefined ? "" : ` — ${issue.role}`;
	return escapeLabel(`#${issue.number} ${issue.title}${role}${suffix}`);
}

/** Arrow shapes: run order is solid, waits are dashed, a serialization rule is thick. */
const arrowFor: Record<QueueGraphEdgeKind, string> = {
	blocker: "-.->",
	gate: "-.->",
	order: "-->",
	rule: "==>",
};

/** Class name per node status; the `classDef` lines use the same names. */
const classFor: Record<QueueGraphNodeStatus, string> = {
	EMPTY: "empty",
	GATED: "gated",
	landed: "landed",
	READY: "ready",
};

/** Edge kinds in print order: the spine first, then the constraints that break it. */
const edgeKindOrder: ReadonlyArray<QueueGraphEdgeKind> = ["order", "gate", "rule", "blocker"];

/** Node statuses in print order, so the class block does not depend on `Map` insertion order. */
const statusOrder: ReadonlyArray<QueueGraphNodeStatus> = ["READY", "GATED", "EMPTY", "landed"];

/** Integration names a gate waits on that no batch in the manifest produces. */
function externalSources(graph: QueueGraph): Array<string> {
	const produced = new Set(graph.nodes.map((node) => node.id));
	const names = new Set<string>();
	for (const edge of graph.edges) {
		if (!produced.has(edge.from)) {
			names.add(edge.from);
		}
	}

	return [...names].sort();
}

/**
 * - The node an edge attaches to: the batch itself, or one of its members when expanded.
 * - @param node - Owning batch.
 * - @param side - Whether the edge leaves (`tail`) or enters (`head`) the batch.
 * - @param issue - Exact member to attach to, when the edge names one.
 * - @param expanded - Whether the rendering draws issue nodes at all.
 * - @returns A Mermaid node id.
 */
function endpoint(
	node: QueueGraphNode,
	side: "head" | "tail",
	issue: string | undefined,
	expanded: boolean,
): string {
	if (!expanded || node.issues.length === 0) {
		return mermaidId(node.id);
	}

	if (issue !== undefined && node.issues.some((member) => member.number === issue)) {
		return issueNodeId(node.id, issue);
	}

	const member = side === "head" ? node.issues[0] : node.issues.at(-1);
	return member === undefined ? mermaidId(node.id) : issueNodeId(node.id, member.number);
}

/**
 * - Where an edge attaches when only a batch name is known.
 * - @param graph - The whole graph, so a gate on an integration no batch produces keeps its node.
 * - @param batch - Batch name, or the integration name for an external gate.
 * - @returns The batch node, or `undefined` when `batch` is not a batch in this graph.
 */
function findNode(graph: QueueGraph, batch: string): undefined | QueueGraphNode {
	return graph.nodes.find((node) => node.id === batch);
}

/** Options shared by the Mermaid block and the Markdown page built around it. */
export interface QueueMermaidOptions {
	/** Draw every batch as a subgraph of its members, in run order. */
	issues?: boolean;
}

/**
 * - The one-line title of a rank's subgraph, naming the profiles its batches would draw.
 * - @param lanes - The graph's lane payload.
 * - @param rank - The rank to label.
 * - @returns Text for a Mermaid subgraph title, before escaping.
 * - @remarks Only rank 0 can name which lane runs which batch: slots are handed out in fire order,
 *   and which one frees first afterwards is a runtime fact. Later ranks therefore name the slot
 *   set, not a pairing.
 */
function rankTitle(lanes: QueueGraphLanes, rank: QueueLaneRank): string {
	const position = `rank ${String(rank.index + 1)}`;
	if (lanes.profiles.length === 0) {
		/* `queue run --parallel` refuses without a catalog, so the graph names the missing piece. */
		return `${position} · no agents.catalog`;
	}

	if (rank.index === 0 && lanes.slots.length > 0) {
		const pairs = lanes.slots
			.map(({ batch, slot }) =>
				`${batch} lane ${String(slot + 1)} ${lanes.profiles[slot] ?? ""}`.trimEnd(),
			)
			.join(", ");
		return `${position} · ${pairs}`;
	}

	const set = lanes.profiles.length === 1 ? "lane 1" : `lanes 1-${String(lanes.profiles.length)}`;
	return `${position} · ${set} ${lanes.profiles.join(", ")}`;
}

/**
 * - Renders the queue as a Mermaid `flowchart`, which GitHub draws natively in files and comments.
 * - @param graph - Payload from {@link buildQueueGraph}.
 * - @param options - `issues` expands each batch into a subgraph of its member issues.
 * - @returns A complete `flowchart LR` block, without a Markdown fence.
 * - @remarks Issue numbers stay inside the node labels: GitHub strips `click` links from Mermaid, so
 *   a link in the diagram would silently disappear.
 *
 *   When the graph carries lanes, each rank becomes a subgraph so the diagram cannot claim a serial
 *   chain where the dispatcher runs batches together. Only in the compact rendering: `issues` already
 *   nests one subgraph per batch, and a second level of nesting is the one thing Mermaid's layout
 *   handles badly. The expanded diagram is the composition view, and the Markdown page below still
 *   carries the ranks.
 * - @example
 *
 *   ```mermaid
 *   flowchart LR
 *     A1["A1 · audio seam<br/>1 issue · READY"]
 *     A1 --> P
 *     P -.->|after progression-work| E1
 *   ```
 */
export function renderQueueMermaid(graph: QueueGraph, options: QueueMermaidOptions = {}): string {
	const expanded = options.issues === true;
	const lanes = expanded ? undefined : graph.lanes;
	/** Batch -> the rank it belongs to, so the declaration loop knows when to open a subgraph. */
	const rankOfBatch = new Map<string, number>();
	for (const rank of lanes?.ranks ?? []) {
		for (const batch of rank.batches) {
			rankOfBatch.set(batch, rank.index);
		}
	}

	const lines: Array<string> = ["flowchart LR"];
	/** Rank whose subgraph is open, if any. */
	let openRank: number | undefined;
	const closeRank = (): void => {
		if (openRank === undefined) {
			return;
		}

		lines.push("  end");
		openRank = undefined;
	};

	for (const node of graph.nodes) {
		const rank = rankOfBatch.get(node.id);
		if (lanes !== undefined && rank !== undefined) {
			if (openRank !== rank) {
				closeRank();
				const entry = lanes.ranks[rank];
				const title =
					entry === undefined ? `rank ${String(rank + 1)}` : rankTitle(lanes, entry);
				lines.push(
					`  subgraph rank_${String(rank)}["${escapeLabel(title)}"]`,
					"    direction LR",
				);
				openRank = rank;
			}

			lines.push(`    ${mermaidId(node.id)}["${mermaidNodeLabel(node)}"]`);
			continue;
		}

		closeRank();
		if (expanded && node.issues.length > 0) {
			lines.push(
				`  subgraph ${mermaidId(node.id)}["${mermaidNodeLabel(node)}"]`,
				"    direction LR",
			);
			for (const issue of node.issues) {
				lines.push(
					`    ${issueNodeId(node.id, issue.number)}["${mermaidIssueLabel(issue)}"]`,
				);
			}

			lines.push("  end");
			continue;
		}

		lines.push(`  ${mermaidId(node.id)}["${mermaidNodeLabel(node)}"]`);
	}

	closeRank();

	for (const name of externalSources(graph)) {
		lines.push(`  ${mermaidId(name)}(["${escapeLabel(name)}<br/>integration"])`);
	}

	if (expanded) {
		lines.push("");
		for (const node of graph.nodes) {
			for (let index = 1; index < node.issues.length; index++) {
				const previous = node.issues[index - 1];
				const current = node.issues[index];
				if (previous === undefined || current === undefined) {
					continue;
				}

				const from = issueNodeId(node.id, previous.number);
				const to = issueNodeId(node.id, current.number);
				lines.push(`  ${from} --> ${to}`);
			}
		}
	}

	for (const kind of edgeKindOrder) {
		const edges = graph.edges.filter((edge) => edge.kind === kind);
		if (edges.length === 0) {
			continue;
		}

		lines.push("");
		for (const edge of edges) {
			const source = findNode(graph, edge.from);
			const target = findNode(graph, edge.to);
			/* An external gate keeps the integration node declared above, so it still draws. */
			const from =
				source === undefined
					? mermaidId(edge.from)
					: endpoint(source, "tail", edge.fromIssue, expanded);
			const to =
				target === undefined
					? mermaidId(edge.to)
					: endpoint(target, "head", edge.toIssue, expanded);
			const label = edge.kind === "order" ? "" : `|${escapeLabel(edge.label)}|`;
			lines.push(`  ${from} ${arrowFor[kind]}${label} ${to}`);
		}
	}

	lines.push(
		"",
		"  classDef ready fill:#1f6feb22,stroke:#1f6feb",
		"  classDef gated fill:#d2992222,stroke:#d29922",
		"  classDef empty fill:#6e768155,stroke:#6e7681",
		"  classDef landed fill:#23863622,stroke:#238636",
	);
	for (const status of statusOrder) {
		const ids: Array<string> = [];
		for (const node of graph.nodes) {
			if (node.status !== status) {
				continue;
			}

			if (expanded && node.issues.length > 0) {
				ids.push(...node.issues.map((issue) => issueNodeId(node.id, issue.number)));
			} else {
				ids.push(mermaidId(node.id));
			}
		}

		if (ids.length > 0) {
			lines.push(`  class ${ids.join(",")} ${classFor[status]}`);
		}
	}

	return lines.join("\n");
}

/**
 * Marker `queue graph --comment` searches for, so it patches its own comment instead of posting a
 * new one.
 */
export const queueGraphCommentMarker = "<!-- sandcastle:queue-graph -->";

/** `17 batches · 3 READY · 14 GATED · manifest updated <stamp>` */
function summaryLine(graph: QueueGraph): string {
	const counts = statusOrder
		.map((status) => ({
			count: graph.nodes.filter((node) => node.status === status).length,
			status,
		}))
		.filter((entry) => entry.count > 0)
		.map((entry) => `${entry.count} ${entry.status}`);
	const batches = graph.nodes.length === 1 ? "1 batch" : `${graph.nodes.length} batches`;
	const updated = graph.updated === "" ? "never updated" : `manifest updated ${graph.updated}`;
	return `${batches} · ${counts.join(" · ")} · ${updated}`;
}

/** How to read the arrows and the node colors; the same wording the CLI help topic uses. */
const legendLines: ReadonlyArray<string> = [
	"- `-->` run order: dispatch priority in manifest order, not a base chain. Every batch starts from `--base`; only members inside one batch chain.",
	"- `-.->` `after <integration>`: a run-order gate, open once that integration is composed and landed.",
	"- `==>` `<rule>`: a serialization rule; the two batches must never be in flight together.",
	"- `-.->` `blocked by #n`: a live GitHub blocked-by edge crossing batches.",
	"- Node status: `READY` fires now, `GATED` has a reason, `EMPTY` has no members, `landed` has every member closed.",
];

/**
 * - The lane block both human renderings print, or nothing for a serial queue.
 * - @param lanes - The graph's lane payload.
 * - @param format - `md` for the page, `text` for the terminal.
 * - @returns Lines to append, empty when there are no lanes.
 * - @remarks The rank list is the payload's own, so the page cannot disagree with `queue graph
 *   --json` about which batches share a step.
 */
function laneLines(lanes: QueueGraphLanes, format: "md" | "text"): Array<string> {
	if (format === "md") {
		const lines = ["", "**Parallel lanes**", ""];
		if (lanes.profiles.length === 0) {
			lines.push(
				"- No profile per lane: `agents.catalog` is empty, and `queue run --parallel` refuses without one.",
			);
			return lines;
		}

		for (const rank of lanes.ranks) {
			const batches = rank.batches.join(", ");
			const where =
				rank.index === 0 && lanes.slots.length > 0
					? ` (${lanes.slots
							.map(({ batch, slot }) => `${batch} in lane ${String(slot + 1)}`)
							.join(", ")})`
					: "";
			lines.push(`- rank ${String(rank.index + 1)}: ${batches}${where}`);
		}

		const lanesNamed = lanes.profiles
			.map((profile, slot) => `lane ${String(slot + 1)} runs \`${profile}\``)
			.join("; ");
		lines.push(
			"",
			`${lanesNamed}. Only rank 1's pairing is fixed: slots are handed out in fire order, so later ranks take whichever lane frees first.`,
		);
		return lines;
	}

	const lines = ["", "  Parallel lanes:"];
	if (lanes.profiles.length === 0) {
		lines.push(
			"    no profile per lane: agents.catalog is empty, so --parallel refuses to run",
		);
		return lines;
	}

	for (const rank of lanes.ranks) {
		const where =
			rank.index === 0 && lanes.slots.length > 0
				? ` (${lanes.slots
						.map(({ batch, slot }) => `${batch} in lane ${String(slot + 1)}`)
						.join(", ")})`
				: "";
		lines.push(`    rank ${String(rank.index + 1)}: ${rank.batches.join(", ")}${where}`);
	}

	lines.push(
		`    lane profiles: ${lanes.profiles
			.map((profile, slot) => `${String(slot + 1)}=${profile}`)
			.join(" ")}`,
	);
	return lines;
}

/**
 * - Renders the queue graph as the Markdown page `queue graph --write` and `--comment` publish.
 * - @param graph - Payload from {@link buildQueueGraph}.
 * - @param options - `issues` expands each batch into a subgraph of its member issues.
 * - @returns Markdown: the comment marker, a Mermaid fence, the legend, and the pending lists.
 * - @remarks Deliberately timestamp-free: a `--write` file is diffed to catch schedule drift, and
 *   `updated` already records how fresh the manifest behind it is.
 */
export function renderQueueMarkdown(graph: QueueGraph, options: QueueMermaidOptions = {}): string {
	const lines: Array<string> = [
		queueGraphCommentMarker,
		"",
		"## Queue run order",
		"",
		summaryLine(graph),
		"",
		"```mermaid",
		renderQueueMermaid(graph, options),
		"```",
		"",
		"**How to read it**",
		"",
		...legendLines,
	];

	if (graph.lanes !== undefined) {
		lines.push(...laneLines(graph.lanes, "md"));
	}

	if (graph.rules.length > 0) {
		lines.push("", "**Serialization rules**", "");
		for (const rule of graph.rules) {
			const members = rule.issues.map((issue) => `#${issue}`).join(", ");
			const name = rule.name === undefined ? "" : `**${rule.name}** — `;
			lines.push(`- ${name}${members} — ${rule.reason}`);
		}
	}

	if (graph.gated.length > 0) {
		lines.push("", "**Gated** (joins a batch once the condition clears)", "");
		for (const entry of graph.gated) {
			const joins = entry.joins === undefined ? "" : ` → ${entry.joins}`;
			lines.push(`- #${entry.issue}${joins} — ${entry.reason}`);
		}
	}

	if (graph.human.length > 0) {
		lines.push("", "**Human** (never queued; needs a decision session)", "");
		for (const entry of graph.human) {
			lines.push(`- #${entry.issue} — ${entry.reason}`);
		}
	}

	lines.push(
		"",
		"---",
		"",
		`Rendered from \`${graph.repository.owner}/${graph.repository.name}\` by \`sandcastle queue graph\`; \`pnpm sandcastle queue check\` reports drift.`,
	);
	return `${lines.join("\n")}\n`;
}

/** Status marks, matching `queue list` so the two views read the same way. */
const statusMark: Record<QueueGraphNodeStatus, string> = {
	EMPTY: "∅",
	GATED: "⏸",
	landed: "●",
	READY: "✓",
};

/** `A1 · audio seam` — the name and the short label, as the Mermaid node upper line shows it. */
function asciiTitle(node: QueueGraphNode): string {
	return node.title === undefined ? node.name : `${node.name} · ${node.title}`;
}

/**
 * - Renders the queue graph for a terminal: the run order, then every edge that breaks it.
 * - @param graph - Payload from {@link buildQueueGraph}.
 * - @returns A plain-text preview; `order` edges are the numbered list, so they are not drawn again.
 * - @remarks Kept narrow enough to read in a normal terminal. The Mermaid block is the rendering to
 *   share; this one is the one to glance at.
 * - @example
 *
 *   ```text
 *   ── Sandcastle queue graph (lisachandra/rbxts) ──
 *   #1  ✓ READY  A1 · audio seam   1 issue(s)
 *   ```
 */
export function renderQueueAscii(graph: QueueGraph): string {
	const repository = `${graph.repository.owner}/${graph.repository.name}`;
	const lines: Array<string> = [`── Sandcastle queue graph (${repository}) ──`];
	const updated = graph.updated === "" ? "never" : graph.updated;
	lines.push(`  Manifest updated: ${updated}`, "", "  Run order:");

	for (const [index, node] of graph.nodes.entries()) {
		const position = `#${index + 1}`.padEnd(4);
		const status = `${statusMark[node.status]} ${node.status}`.padEnd(8);
		const title = asciiTitle(node).padEnd(26);
		const count = `${node.issues.length} issue(s)`.padEnd(10);
		lines.push(`  ${position} ${status} ${title} ${count} ${node.branch}`.trimEnd());
		for (const reason of node.reasons) {
			lines.push(`         ✗ ${reason}`);
		}

		for (const note of node.notes) {
			lines.push(`         · ${note}`);
		}
	}

	if (graph.lanes !== undefined) {
		lines.push(...laneLines(graph.lanes, "text"));
	}

	const rendered = graph.edges.filter((edge) => edge.kind !== "order");
	if (rendered.length > 0) {
		lines.push("", "  Edges (run order is the list above):");
		for (const kind of edgeKindOrder) {
			if (kind === "order") {
				continue;
			}

			for (const edge of rendered) {
				if (edge.kind !== kind) {
					continue;
				}

				const route = `${edge.from} → ${edge.to}`.padEnd(18);
				lines.push(`    ${kind.padEnd(8)} ${route} ${edge.label}`);
			}
		}
	}

	if (graph.gated.length > 0) {
		lines.push("", "  Gated (joins a batch once the condition clears):");
		for (const entry of graph.gated) {
			const joins = entry.joins === undefined ? "" : ` → ${entry.joins}`;
			lines.push(`    #${entry.issue}${joins} — ${entry.reason}`);
		}
	}

	if (graph.human.length > 0) {
		lines.push("", "  Human (never queued):");
		for (const entry of graph.human) {
			lines.push(`    #${entry.issue} — ${entry.reason}`);
		}
	}

	return lines.join("\n");
}

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
	afterMerge: string | undefined;
	/** Batch name, e.g. "U2"; also the node id. */
	id: string;
	/** Members in run order. */
	issues: Array<QueueGraphIssue>;
	/** Integration branch `sandcastle merge` uses for this batch, when it declares one. */
	mergeName: string | undefined;
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
	nodes: Array<QueueGraphNode>;
	/** `owner/name`, so a rendering can link the issues it names. */
	repository: { name: string; owner: string };
	/** Serialization rules, for the legend; the `rule` edges label themselves from these. */
	rules: QueueManifest["serialized"];
	/** Manifest stamp the graph was built from; stable per manifest, unlike `generatedAt`. */
	updated: string;
}

export interface QueueGraphOptions {
	generatedAt: string;
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
		afterMerge: sequence.afterMerge,
		id: sequence.name,
		issues,
		mergeName: sequence.mergeName,
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
		if (node.afterMerge === undefined) {
			continue;
		}

		const producers = nodes.filter((candidate) => candidate.mergeName === node.afterMerge);
		const sources = producers.length === 0 ? [undefined] : producers;
		for (const producer of sources) {
			edges.push({
				detail:
					producer === undefined
						? `${node.name} waits on integration ${node.afterMerge}, which no batch here produces`
						: `${producer.name} produces integration ${node.afterMerge}`,
				from: producer?.id ?? node.afterMerge,
				fromIssue: undefined,
				kind: "gate",
				label: `after ${node.afterMerge}`,
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
	return {
		edges: [
			...orderEdges(nodes),
			...gateEdges(nodes),
			...ruleEdges(nodes, view.rules),
			...blockerEdges(nodes),
		],
		gated: view.gated,
		generatedAt: options.generatedAt,
		human: view.human,
		nodes,
		repository: options.repository,
		rules: view.rules,
		updated: view.updated,
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

/** Mermaid labels are HTML-ish, so the four metacharacters have to become entities. */
function escapeLabel(text: string): string {
	return text
		.replaceAll("&", "#amp;")
		.replaceAll('"', "#quot;")
		.replaceAll("<", "#lt;")
		.replaceAll(">", "#gt;");
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
 * - Renders the queue as a Mermaid `flowchart`, which GitHub draws natively in files and comments.
 * - @param graph - Payload from {@link buildQueueGraph}.
 * - @param options - `issues` expands each batch into a subgraph of its member issues.
 * - @returns A complete `flowchart LR` block, without a Markdown fence.
 * - @remarks Issue numbers stay inside the node labels: GitHub strips `click` links from Mermaid, so
 *   a link in the diagram would silently disappear.
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
	const lines: Array<string> = ["flowchart LR"];
	for (const node of graph.nodes) {
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
	"- `-->` run order: the dispatch spine, left to right. Batches are ordered, not dependent.",
	"- `-.->` `after <integration>`: a run-order gate, open once that integration is composed and landed.",
	"- `==>` `<rule>`: a serialization rule; the two batches must never be in flight together.",
	"- `-.->` `blocked by #n`: a live GitHub blocked-by edge crossing batches.",
	"- Node status: `READY` fires now, `GATED` has a reason, `EMPTY` has no members, `landed` has every member closed.",
];

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
		const merge = node.mergeName === undefined ? "" : `merge: ${node.mergeName}`;
		lines.push(`  ${position} ${status} ${title} ${count} ${merge}`.trimEnd());
		for (const reason of node.reasons) {
			lines.push(`         ✗ ${reason}`);
		}

		for (const note of node.notes) {
			lines.push(`         · ${note}`);
		}
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

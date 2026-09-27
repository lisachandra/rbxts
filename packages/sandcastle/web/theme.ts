/*
 * Page theme.
 *
 * The status colors are the same four the Mermaid renderer classifies with, so a batch reads the
 * same way in the diagram, the terminal preview, and here.
 */

import type { QueueGraphEdgeKind, QueueGraphNodeStatus } from "../src/queue/graph.ts";

export const statusColors: Record<QueueGraphNodeStatus, string> = {
	EMPTY: "#6e7681",
	GATED: "#d29922",
	landed: "#238636",
	READY: "#1f6feb",
};

export const edgeColors: Record<QueueGraphEdgeKind, string> = {
	blocker: "#f778ba",
	gate: "#d29922",
	order: "#8b949e",
	rule: "#a371f7",
};

/** Plain-language name for each edge kind, used by the toolbar and the legend. */
export const edgeLabels: Record<QueueGraphEdgeKind, string> = {
	blocker: "blocked by",
	gate: "after merge",
	order: "run order",
	rule: "serialized rule",
};

/** Every edge kind, in the order the toolbar and the legend list them. */
export const edgeKindList: ReadonlyArray<QueueGraphEdgeKind> = ["blocker", "gate", "order", "rule"];

/** Every status a batch can read as, in the order the toolbar and the legend list them. */
export const statusList: ReadonlyArray<QueueGraphNodeStatus> = [
	"EMPTY",
	"GATED",
	"READY",
	"landed",
];

export const panelWidth = 380;

/*
 * The graph itself: one node per batch, laid out by dagre.
 *
 * Two layouts share the canvas. "lanes" ranks by the constraint edges (gates, rules, blockers)
 * and draws the run order as a numbered overlay, so batches nothing constrains share a rank and
 * sit side by side like a state chart. "spine" ranks by the run order instead, so the dispatch
 * sequence reads left to right exactly as the Mermaid rendering draws it. Filtering a layer out of
 * the layout would re-rank the diagram, so a hidden layer only loses its edges; the nodes stay put
 * and the diagram stays comparable between toggles.
 */

import { type ReactElement, useMemo } from "react";

import dagre from "@dagrejs/dagre";
import { Background, Controls, type Edge, MarkerType, MiniMap, ReactFlow } from "@xyflow/react";

import type { QueueGraph, QueueGraphEdgeKind } from "../src/queue/graph.ts";
import { BatchNode, type BatchNodeType } from "./BatchNode.js";
import { NodeCard } from "./NodeCard.js";
import { edgeColors, edgeLabels, statusColors } from "./theme.js";

const batchNodeType = { batch: BatchNode };
type FlowBatchNode = BatchNodeType;

/**
 * Long constraint labels collide mid-edge, so the canvas shows a clipped label; the full text lives
 * in the detail panel.
 */
const maxEdgeLabel = 30;

const nodeHeight = 96;
const nodeWidth = 248;

/** Which edge set ranks the dagre diagram: constraints fan out, the spine stays a line. */
export type QueueLayout = "lanes" | "spine";

/** Dagre rank direction: top-to-bottom fans lanes out, left-to-right reads like the Mermaid chart. */
export type QueueDirection = "LR" | "TB";

export interface QueueGraphViewProps {
	direction: QueueDirection;
	graph: QueueGraph;
	/** Edge kinds the reader wants to see. */
	layers: Record<QueueGraphEdgeKind, boolean>;
	/** Lanes rank by constraints, spine by the run order. */
	layout: QueueLayout;
	onSelect: (batch: string | undefined) => void;
	/** Batch shown in the detail panel. */
	selected: string | undefined;
	/** Batches to draw; a filter, not a hide, so the layout never changes shape. */
	visible: ReadonlySet<string>;
}

/**
 * - Dagre positions every node once, from the whole graph, so toggles never re-rank the diagram.
 * - @param graph - The payload behind the page.
 * - @param layout - `lanes` ranks by the constraints, `spine` by the run order.
 * - @param direction - Dagre rank direction.
 * - @returns Top-left canvas coordinates per batch.
 * - @remarks A total chain has exactly one ranking, so the spine can never fan out: lanes mode keeps
 *   the run order out of the ranking and draws it as an overlay instead.
 */
function positionsFor(
	graph: QueueGraph,
	layout: QueueLayout,
	direction: QueueDirection,
): Map<string, { x: number; y: number }> {
	const engine = new dagre.graphlib.Graph();
	/* TB fans lanes sideways, LR stacks the spine: each direction pads the axis edges travel on. */
	const spacing =
		direction === "TB" ? { nodesep: 48, ranksep: 140 } : { nodesep: 40, ranksep: 120 };
	engine.setGraph({ marginx: 16, marginy: 16, ...spacing, rankdir: direction });
	engine.setDefaultEdgeLabel(() => ({}));
	for (const node of graph.nodes) {
		engine.setNode(node.id, { height: nodeHeight, width: nodeWidth });
	}

	const ranked = layout === "lanes" ? new Set(["blocker", "gate", "rule"]) : new Set(["order"]);
	for (const edge of graph.edges) {
		if (ranked.has(edge.kind)) {
			engine.setEdge(edge.from, edge.to);
		}
	}

	dagre.layout(engine);

	const positions = new Map<string, { x: number; y: number }>();
	for (const node of graph.nodes) {
		const placed = engine.node(node.id) as undefined | { x: number; y: number };
		if (placed !== undefined) {
			positions.set(node.id, { x: placed.x - nodeWidth / 2, y: placed.y - nodeHeight / 2 });
		}
	}

	return positions;
}

/**
 * - Which side an edge leaves and enters on, so horizontal neighbours stop bending through top/bottom
 *   handles.
 * - @param direction - Dagre rank direction.
 * - @param lane - Parity lane for constraint edges, so parallel edges between one pair split
 *   channels.
 * - @returns Source/target handle ids in the `batch` node type.
 */
function handlesFor(direction: QueueDirection, lane: number): { source: string; target: string } {
	if (direction === "LR") {
		const side = lane % 2 === 0 ? "right" : "left";
		return { source: `${side}-source`, target: `${side}-target` };
	}

	const side = lane % 2 === 0 ? "bottom" : "top";
	return { source: `${side}-source`, target: `${side}-target` };
}

/** Clips a constraint label to `maxEdgeLabel` characters at a word boundary. */
function shortLabel(text: string): string {
	if (text.length <= maxEdgeLabel) {
		return text;
	}

	const clipped = text.slice(0, maxEdgeLabel);
	const boundary = clipped.lastIndexOf(" ");
	return `${(boundary === -1 ? clipped : clipped.slice(0, boundary)).trimEnd()}…`;
}

export function QueueGraphView({
	direction,
	graph,
	layers,
	layout,
	onSelect,
	selected,
	visible,
}: QueueGraphViewProps): ReactElement {
	const nodes = useMemo<Array<FlowBatchNode>>(() => {
		const positions = positionsFor(graph, layout, direction);
		const order = new Map(graph.nodes.map((node, index) => [node.id, index + 1]));
		return graph.nodes
			.filter((node) => visible.has(node.id))
			.map(
				(node): FlowBatchNode => ({
					type: "batch",
					data: {
						label: (
							<NodeCard
								node={node}
								position={layout === "lanes" ? order.get(node.id) : undefined}
								selected={node.id === selected}
							/>
						),
					},
					id: node.id,
					position: positions.get(node.id) ?? { x: 0, y: 0 },
					/* Handles need a sized box; the card still draws its own frame. */
					style: { height: nodeHeight, padding: 0, width: nodeWidth },
				}),
			);
	}, [direction, graph, layout, selected, visible]);

	const edges = useMemo<Array<Edge>>(() => {
		/* Constraint lanes alternate sides so a second edge between one pair takes its own channel. */
		const laneOf = new Map<string, number>();
		return graph.edges
			.filter((edge) => layers[edge.kind] && visible.has(edge.from) && visible.has(edge.to))
			.map((edge, index) => {
				/* Order edges rank the spine and stay central; constraints fan to alternating sides. */
				const laneKey = `${edge.from}>${edge.to}`;
				const lane = edge.kind === "order" ? 0 : (laneOf.get(laneKey) ?? 0) + 1;
				laneOf.set(laneKey, lane);
				const handles =
					edge.kind === "order" ? handlesFor(direction, 0) : handlesFor(direction, lane);
				const label =
					edge.kind === "order"
						? undefined
						: `${edgeLabels[edge.kind]}: ${shortLabel(edge.label)}`;
				return {
					type: "smoothstep",
					ariaLabel: label ?? "run order",
					id: `${edge.from}-${edge.to}-${edge.kind}-${index}`,
					label,
					labelBgPadding: [8, 4] as [number, number],
					labelBgStyle: { fill: "#0d1117", fillOpacity: 0.92 },
					labelStyle: { fill: "#c9d1d9", fontSize: 12 },
					markerEnd: { type: MarkerType.ArrowClosed },
					source: edge.from,
					sourceHandle: handles.source,
					style: {
						opacity: edge.kind === "order" && layout === "lanes" ? 0.35 : 1,
						stroke: edgeColors[edge.kind],
						strokeDasharray:
							edge.kind === "gate" ||
							edge.kind === "blocker" ||
							(edge.kind === "order" && layout === "lanes")
								? "6 3"
								: undefined,
						strokeWidth:
							edge.kind === "rule"
								? 3
								: edge.kind === "order" && layout === "lanes"
									? 1
									: 1.6,
					},
					target: edge.to,
					targetHandle: handles.target,
				} satisfies Edge;
			});
	}, [direction, graph, layers, layout, visible]);

	return (
		<ReactFlow
			edges={edges}
			fitView={true}
			fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
			/*
			 * A long spine shrinks into unreadable cards if the view is allowed to fit it whole, so the
			 * floor caps the shrinkage and leaves the overflow to panning.
			 */
			minZoom={0.5}
			nodes={nodes}
			nodeTypes={batchNodeType}
			onNodeClick={(_, node) => {
				onSelect(node.id === selected ? undefined : node.id);
			}}
			onPaneClick={() => {
				onSelect(undefined);
			}}
			proOptions={{ hideAttribution: true }}
		>
			<Background color="#21262d" gap={22} />
			<Controls />
			<MiniMap
				// A translucent mask keeps the batched outline visible under the viewport rectangle.
				maskColor="#0d111766"
				nodeColor={(node) => {
					const batch = graph.nodes.find((candidate) => candidate.id === node.id);
					return batch === undefined ? "#6e7681" : statusColors[batch.status];
				}}
				pannable={true}
				zoomable={true}
			/>
		</ReactFlow>
	);
}

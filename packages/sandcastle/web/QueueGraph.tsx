/*
 * The graph itself: a layered left-to-right DAG, one node per batch.
 *
 * Layout comes from dagre, which ranks by the edges it is given - so the run order is the backbone
 * and the gates, rules, and blockers hang off it, exactly as the Mermaid rendering draws them.
 * Filtering a layer out of the layout would re-rank the diagram, so a hidden layer only loses its
 * edges; the nodes stay put and the diagram stays comparable between toggles.
 */

import { type ReactElement, useMemo } from "react";

import dagre from "@dagrejs/dagre";
import {
	Background,
	Controls,
	type Edge,
	MarkerType,
	MiniMap,
	type Node,
	ReactFlow,
} from "@xyflow/react";

import type { QueueGraph, QueueGraphEdgeKind } from "../src/queue/graph.ts";
import { NodeCard } from "./NodeCard.js";
import { edgeColors, edgeLabels, statusColors } from "./theme.js";

const nodeHeight = 96;
const nodeWidth = 248;

export interface QueueGraphViewProps {
	graph: QueueGraph;
	/** Edge kinds the reader wants to see. */
	layers: Record<QueueGraphEdgeKind, boolean>;
	onSelect: (batch: string | undefined) => void;
	/** Batch shown in the detail panel. */
	selected: string | undefined;
	/** Batches to draw; a filter, not a hide, so the layout never changes shape. */
	visible: ReadonlySet<string>;
}

/** Dagre positions every node once, from the whole graph, so toggles never re-rank the diagram. */
function positionsFor(graph: QueueGraph): Map<string, { x: number; y: number }> {
	const engine = new dagre.graphlib.Graph();
	engine.setGraph({ marginx: 16, marginy: 16, nodesep: 28, rankdir: "LR", ranksep: 96 });
	engine.setDefaultEdgeLabel(() => ({}));
	for (const node of graph.nodes) {
		engine.setNode(node.id, { height: nodeHeight, width: nodeWidth });
	}

	// Only the run order ranks the diagram; a gate or blocker edge would drag its batch sideways.
	for (const edge of graph.edges) {
		if (edge.kind === "order") {
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

export function QueueGraphView({
	graph,
	layers,
	onSelect,
	selected,
	visible,
}: QueueGraphViewProps): ReactElement {
	const nodes = useMemo<Array<Node>>(() => {
		const positions = positionsFor(graph);
		return graph.nodes
			.filter((node) => visible.has(node.id))
			.map((node) => ({
				data: { label: <NodeCard node={node} selected={node.id === selected} /> },
				id: node.id,
				position: positions.get(node.id) ?? { x: 0, y: 0 },
				style: { height: nodeHeight, padding: 0, width: nodeWidth },
			}));
	}, [graph, selected, visible]);

	const edges = useMemo<Array<Edge>>(
		() =>
			graph.edges
				.filter(
					(edge) => layers[edge.kind] && visible.has(edge.from) && visible.has(edge.to),
				)
				.map((edge, index) => ({
					type: "smoothstep",
					id: `${edge.from}-${edge.to}-${edge.kind}-${index}`,
					label:
						edge.kind === "order"
							? undefined
							: `${edgeLabels[edge.kind]}: ${edge.label}`,
					labelBgPadding: [4, 2] as [number, number],
					labelBgStyle: { fill: "#0d1117", fillOpacity: 0.85 },
					labelStyle: { fill: "#c9d1d9", fontSize: 11 },
					markerEnd: { type: MarkerType.ArrowClosed },
					source: edge.from,
					style: {
						stroke: edgeColors[edge.kind],
						strokeDasharray:
							edge.kind === "gate" || edge.kind === "blocker" ? "6 3" : undefined,
						strokeWidth: edge.kind === "rule" ? 3 : 1.6,
					},
					target: edge.to,
				})),
		[graph, layers, visible],
	);

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

/*
 * The toolbar: filters plus the two layout switches, the only place that knows their labels.
 *
 * Layer toggles drop the edges of one kind; status toggles drop whole cards. The two behave
 * differently on purpose - a hidden layer keeps every node where dagre put it, so the diagram stays
 * comparable between toggles, while a hidden status is a genuine "show me less".
 */

import type { ReactElement } from "react";

import { useReactFlow } from "@xyflow/react";

import type { QueueGraphEdgeKind, QueueGraphNodeStatus } from "../src/queue/graph.ts";
import type { QueueDirection, QueueLayout } from "./QueueGraph.js";
import { edgeKindList, edgeLabels, statusList } from "./theme.js";

export interface ToolbarProps {
	direction: QueueDirection;
	layers: Record<QueueGraphEdgeKind, boolean>;
	layout: QueueLayout;
	loading: boolean;
	onDirection: (direction: QueueDirection) => void;
	onLayout: (layout: QueueLayout) => void;
	onRefresh: () => void;
	onToggleLayer: (kind: QueueGraphEdgeKind) => void;
	onToggleStatus: (status: QueueGraphNodeStatus) => void;
	statuses: Record<QueueGraphNodeStatus, boolean>;
	subtitle: string;
}

export function Toolbar({
	direction,
	layers,
	layout,
	loading,
	onDirection,
	onLayout,
	onRefresh,
	onToggleLayer,
	onToggleStatus,
	statuses,
	subtitle,
}: ToolbarProps): ReactElement {
	const flow = useReactFlow();
	return (
		<header className="toolbar">
			<span className="toolbar-title">Queue graph</span>
			<span className="toolbar-sub">{subtitle}</span>
			<span className="spacer" />
			<div className="tool-group">
				<span className="tool-group-label">edges</span>
				{edgeKindList.map((kind) => (
					<label key={kind} className="toggle">
						<input
							checked={layers[kind]}
							onChange={() => {
								onToggleLayer(kind);
							}}
							type="checkbox"
						/>
						{edgeLabels[kind]}
					</label>
				))}
			</div>
			<div className="tool-group">
				<span className="tool-group-label">layout</span>
				<label className="toggle">
					<input
						checked={layout === "lanes"}
						onChange={() => {
							onLayout(layout === "lanes" ? "spine" : "lanes");
						}}
						type="checkbox"
					/>
					{layout === "lanes" ? "lanes" : "run order"}
				</label>
				<label className="toggle">
					<input
						checked={direction === "TB"}
						onChange={() => {
							onDirection(direction === "TB" ? "LR" : "TB");
						}}
						type="checkbox"
					/>
					top-down
				</label>
			</div>
			<div className="tool-group">
				<span className="tool-group-label">batches</span>
				{statusList.map((status) => (
					<label key={status} className="toggle">
						<input
							checked={statuses[status]}
							onChange={() => {
								onToggleStatus(status);
							}}
							type="checkbox"
						/>
						{status}
					</label>
				))}
			</div>
			<button
				className="button"
				onClick={() => {
					void flow.fitView({ padding: 0.15 });
				}}
				type="button"
			>
				Fit view
			</button>
			<button className="button" disabled={loading} onClick={onRefresh} type="button">
				{loading ? "Refreshing…" : "Refresh"}
			</button>
		</header>
	);
}

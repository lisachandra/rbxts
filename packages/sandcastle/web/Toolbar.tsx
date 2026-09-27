/*
 * The toolbar: one row of filters, and the only place that knows what a toggle is called.
 *
 * Layer toggles drop the edges of one kind; status toggles drop whole cards. The two behave
 * differently on purpose - a hidden layer keeps every node where dagre put it, so the diagram stays
 * comparable between toggles, while a hidden status is a genuine "show me less".
 */

import type { ReactElement } from "react";

import { useReactFlow } from "@xyflow/react";

import type { QueueGraphEdgeKind, QueueGraphNodeStatus } from "../src/queue/graph.ts";
import { edgeKindList, edgeLabels, statusList } from "./theme.js";

export interface ToolbarProps {
	layers: Record<QueueGraphEdgeKind, boolean>;
	loading: boolean;
	onRefresh: () => void;
	onToggleLayer: (kind: QueueGraphEdgeKind) => void;
	onToggleStatus: (status: QueueGraphNodeStatus) => void;
	statuses: Record<QueueGraphNodeStatus, boolean>;
	subtitle: string;
}

export function Toolbar({
	layers,
	loading,
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

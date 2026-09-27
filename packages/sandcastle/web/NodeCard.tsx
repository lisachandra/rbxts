/*
 * One batch, drawn as a card.
 *
 * The card carries exactly what the Mermaid label carries - name, short title, issue count, status
 * - plus the role count the CLI cannot fit. Hovering the card spells the roles out, since a card is
 * too small to list them and the panel is a click away.
 */

import type { ReactElement } from "react";

import type { QueueGraphNode } from "../src/queue/graph.ts";
import { statusColors } from "./theme.js";

export interface NodeCardProps {
	node: QueueGraphNode;
	selected: boolean;
}

export function NodeCard({ node, selected }: NodeCardProps): ReactElement {
	const color = statusColors[node.status];
	const listed = node.roles === undefined ? [] : Object.entries(node.roles);
	const roles = listed.length;
	// Tooltips are still the cheapest place to put a list this long; the panel repeats it on click.
	const hover = listed.map(([issue, role]) => `#${issue} ${role}`).join("\n");

	return (
		<div
			className={`card${selected ? " card-selected" : ""}`}
			style={{ borderColor: color }}
			title={hover === "" ? undefined : hover}
		>
			<div className="card-head">
				<span className="card-name">{node.name}</span>
				<span className="pill" style={{ backgroundColor: color }}>
					{node.status}
				</span>
			</div>
			{node.title === undefined ? null : <div className="card-title">{node.title}</div>}
			<div className="card-meta">
				<span>
					{node.issues.length} {node.issues.length === 1 ? "issue" : "issues"}
				</span>
				{roles === 0 ? null : <span>{roles} roles</span>}
			</div>
			{node.mergeName === undefined ? null : (
				<div className="card-merge">merge: {node.mergeName}</div>
			)}
		</div>
	);
}

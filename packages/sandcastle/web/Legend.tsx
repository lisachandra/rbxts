/*
 * The legend: what each color means, worded the way the Mermaid rendering words it.
 *
 * The colors are the payload here, so the legend reads them from the same tables the cards and the
 * edges use - it cannot drift from the graph it explains.
 */

import type { ReactElement } from "react";

import { edgeColors, edgeKindList, edgeLabels, statusColors, statusList } from "./theme.js";

export function Legend(): ReactElement {
	return (
		<footer className="legend">
			{statusList.map((status) => (
				<span key={status}>
					<span
						className="legend-swatch"
						style={{ backgroundColor: statusColors[status] }}
					/>
					{status}
				</span>
			))}
			{edgeKindList.map((kind) => (
				<span key={kind}>
					<span className="legend-swatch" style={{ backgroundColor: edgeColors[kind] }} />
					{edgeLabels[kind]}
				</span>
			))}
		</footer>
	);
}

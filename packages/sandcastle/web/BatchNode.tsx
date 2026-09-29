/*
 * One batch node: the card plus edge handles on all four sides.
 *
 * The default node type only exposes top/bottom handles, which forced horizontal neighbours onto
 * orthogonal bends. Eight handles (source + target per side) let edges attach along the dagre rank
 * direction and give parallel edges their own side channels.
 */

import type { ReactElement } from "react";

import { Handle, type Node, Position } from "@xyflow/react";

/** Every handle a batch card exposes; edges pick theirs from the rank direction. */
const ports: ReadonlyArray<{
	id: string;
	position: Position;
	type: "source" | "target";
}> = [
	{ type: "source", id: "top-source", position: Position.Top },
	{ type: "target", id: "top-target", position: Position.Top },
	{ type: "source", id: "bottom-source", position: Position.Bottom },
	{ type: "target", id: "bottom-target", position: Position.Bottom },
	{ type: "source", id: "left-source", position: Position.Left },
	{ type: "target", id: "left-target", position: Position.Left },
	{ type: "source", id: "right-source", position: Position.Right },
	{ type: "target", id: "right-target", position: Position.Right },
];

export type BatchNodeType = Node<{ label: ReactElement }, "batch">;

export function BatchNode({ data }: { data: BatchNodeType["data"] }): ReactElement {
	const { label } = data;
	return (
		<>
			{ports.map((port) => (
				<Handle
					key={port.id}
					className="port"
					id={port.id}
					isConnectable={false}
					position={port.position}
					type={port.type}
				/>
			))}
			{label}
		</>
	);
}

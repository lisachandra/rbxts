/*
 * The page: fetch the graph and the raw view, keep the two in step, and own the selection.
 *
 * Both endpoints answer from the same view builder, so the panel and the diagram can never disagree
 * about which batch holds which issue. The selection lives in the URL as `?batch=<id>`, which makes
 * any batch linkable and survives a reload; everything else is page-local state. The flow provider
 * sits above the toolbar so "Fit view" can reach the canvas, and above the panel so a selection is
 * one graph for all three.
 */

import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";

import { ReactFlowProvider } from "@xyflow/react";

import type { QueueGraph, QueueGraphEdgeKind, QueueGraphNodeStatus } from "../src/queue/graph.ts";
import type { QueueView } from "../src/queue/render.ts";
import { DetailPanel } from "./DetailPanel.js";
import { Legend } from "./Legend.js";
import { type QueueDirection, QueueGraphView, type QueueLayout } from "./QueueGraph.js";
import { Toolbar } from "./Toolbar.js";

const allLayers: Record<QueueGraphEdgeKind, boolean> = {
	blocker: true,
	gate: true,
	order: true,
	rule: true,
};

const allStatuses: Record<QueueGraphNodeStatus, boolean> = {
	EMPTY: true,
	GATED: true,
	landed: true,
	READY: true,
};

/**
 * - Reads one shared page-state parameter, so any view is linkable and survives reload.
 * - @param name - Query key.
 * - @returns The value, or `undefined` when absent or empty.
 */
function paramFromUrl(name: string): string | undefined {
	const value = new URLSearchParams(window.location.search).get(name);
	return value === null || value === "" ? undefined : value;
}

function batchFromUrl(): string | undefined {
	return paramFromUrl("batch");
}

/** Lanes is the default: it fans unconstrained batches into parallel ranks instead of one line. */
function layoutFromUrl(): QueueLayout {
	return paramFromUrl("layout") === "spine" ? "spine" : "lanes";
}

/** Top-down is the default: lanes read like a state chart, left-to-right like the Mermaid block. */
function directionFromUrl(): QueueDirection {
	return paramFromUrl("dir") === "LR" ? "LR" : "TB";
}

export function App(): ReactElement {
	const [error, setError] = useState<string | undefined>(undefined);
	const [graph, setGraph] = useState<undefined | QueueGraph>(undefined);
	const [layers, setLayers] = useState<Record<QueueGraphEdgeKind, boolean>>(allLayers);
	const [loading, setLoading] = useState<boolean>(false);
	const [direction, setDirection] = useState<QueueDirection>(directionFromUrl);
	const [layout, setLayout] = useState<QueueLayout>(layoutFromUrl);
	const [selected, setSelected] = useState<string | undefined>(batchFromUrl);
	const [statuses, setStatuses] = useState<Record<QueueGraphNodeStatus, boolean>>(allStatuses);
	const [view, setView] = useState<QueueView | undefined>(undefined);

	/** `refresh` asks the server to re-read GitHub instead of answering from its 30s cache. */
	const load = useCallback(async (refresh: boolean): Promise<void> => {
		setLoading(true);
		try {
			const suffix = refresh ? "?refresh=1" : "";
			const [graphResponse, viewResponse] = await Promise.all([
				fetch(`/api/graph${suffix}`),
				fetch(`/api/queue${suffix}`),
			]);
			if (!graphResponse.ok) {
				throw new Error(`the graph endpoint answered ${graphResponse.status}`);
			}

			setGraph((await graphResponse.json()) as QueueGraph);
			if (viewResponse.ok) {
				setView((await viewResponse.json()) as QueueView);
			}

			setError(undefined);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load(false);
	}, [load]);

	useEffect(() => {
		const query = new URLSearchParams(window.location.search);
		if (selected === undefined) {
			query.delete("batch");
		} else {
			query.set("batch", selected);
		}

		query.set("layout", layout);
		query.set("dir", direction);
		const search = query.toString();
		const url =
			search === "" ? window.location.pathname : `${window.location.pathname}?${search}`;
		window.history.replaceState(null, "", url);
	}, [direction, layout, selected]);

	const visible = useMemo<ReadonlySet<string>>(() => {
		const names = new Set<string>();
		for (const node of graph?.nodes ?? []) {
			if (statuses[node.status]) {
				names.add(node.id);
			}
		}

		return names;
	}, [graph, statuses]);

	const selectedNode = graph?.nodes.find((node) => node.id === selected);
	const selectedSequence = view?.sequences.find((sequence) => sequence.name === selected);

	return (
		<ReactFlowProvider>
			<div className="app">
				<Toolbar
					direction={direction}
					layers={layers}
					layout={layout}
					loading={loading}
					onDirection={setDirection}
					onLayout={setLayout}
					onRefresh={() => {
						void load(true);
					}}
					onToggleLayer={(kind) => {
						setLayers((current) => ({ ...current, [kind]: !current[kind] }));
					}}
					onToggleStatus={(status) => {
						setStatuses((current) => ({ ...current, [status]: !current[status] }));
					}}
					statuses={statuses}
					subtitle={
						graph === undefined
							? "loading the queue"
							: `${graph.nodes.length} batches · updated ${graph.updated}`
					}
				/>
				{error === undefined ? null : <div className="error">{error}</div>}
				<div className="body">
					<div className="canvas">
						{graph === undefined ? null : (
							<QueueGraphView
								direction={direction}
								graph={graph}
								layers={layers}
								layout={layout}
								onSelect={setSelected}
								selected={selected}
								visible={visible}
							/>
						)}
					</div>
					{graph === undefined || selectedNode === undefined ? null : (
						<DetailPanel
							node={selectedNode}
							onClose={() => {
								setSelected(undefined);
							}}
							repository={graph.repository}
							sequence={selectedSequence}
						/>
					)}
				</div>
				<Legend />
			</div>
		</ReactFlowProvider>
	);
}

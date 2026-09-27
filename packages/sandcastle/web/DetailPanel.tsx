/*
 * The panel behind a clicked batch.
 *
 * The card is a summary; this is the manifest entry behind it - members in run order with their
 * roles, the blockers each one carries, the notes that explain the batch's shape, and the reason it
 * is GATED - plus the GitHub links, which the diagram cannot carry because GitHub strips Mermaid
 * click handlers.
 */

import type { ReactElement } from "react";

import type { QueueGraphNode } from "../src/queue/graph.ts";
import type { QueueView } from "../src/queue/render.ts";

export interface DetailPanelProps {
	node: QueueGraphNode;
	onClose: () => void;
	repository: { name: string; owner: string };
	/** The same batch as the raw view reports it; `undefined` until the view has loaded. */
	sequence: undefined | QueueView["sequences"][number];
}

function issueUrl(repository: DetailPanelProps["repository"], issue: string): string {
	return `https://github.com/${repository.owner}/${repository.name}/issues/${issue}`;
}

/** `" · blocked by #1, #2"`, or `""` when nothing blocks it, so the JSX stays a single expression. */
function blockerSummary(blockers: ReadonlyArray<string>): string {
	if (blockers.length === 0) {
		return "";
	}

	const numbers = blockers.map((number) => `#${number}`).join(", ");
	return ` · blocked by ${numbers}`;
}

export function DetailPanel({
	node,
	onClose,
	repository,
	sequence,
}: DetailPanelProps): ReactElement {
	return (
		<aside className="panel">
			<header className="panel-head">
				<div>
					<h2>
						{node.name}
						{node.title === undefined ? "" : ` · ${node.title}`}
					</h2>
					<p className="panel-sub">
						{node.status} · {node.issues.length} issue(s)
					</p>
				</div>
				<button className="button" onClick={onClose} type="button">
					Close
				</button>
			</header>

			<section className="panel-section">
				<h3>Run order</h3>
				<ol className="members">
					{node.issues.map((issue) => (
						<li key={issue.number}>
							<a
								href={issueUrl(repository, issue.number)}
								rel="noreferrer"
								target="_blank"
							>
								#{issue.number}
							</a>{" "}
							{issue.title}
							<div className="member-meta">
								{issue.role === undefined ? null : <span>{issue.role}</span>}
								<span>{issue.found ? issue.state : "not found"}</span>
								{issue.openBlockers.length === 0 ? null : (
									<span className="warn">
										blocked by{" "}
										{issue.openBlockers
											.map((number) => `#${number}`)
											.join(", ")}
									</span>
								)}
							</div>
						</li>
					))}
				</ol>
			</section>

			{node.mergeName === undefined ? null : (
				<section className="panel-section">
					<h3>Integration</h3>
					<p>
						<code>{node.mergeName}</code>
					</p>
					{node.afterMerge === undefined ? null : (
						<p className="panel-sub">waits for {node.afterMerge}</p>
					)}
				</section>
			)}

			{node.reasons.length === 0 ? null : (
				<section className="panel-section">
					<h3>Why it is not firing</h3>
					<ul className="reasons">
						{node.reasons.map((reason) => (
							<li key={reason}>{reason}</li>
						))}
					</ul>
				</section>
			)}

			{node.notes.length === 0 ? null : (
				<section className="panel-section">
					<h3>Notes</h3>
					<ul className="notes">
						{node.notes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				</section>
			)}

			{sequence === undefined ? null : (
				<section className="panel-section">
					<h3>Members on GitHub</h3>
					<ul className="notes">
						{sequence.issues.map((issue) => (
							<li key={issue.number}>
								<a
									href={issueUrl(repository, issue.number)}
									rel="noreferrer"
									target="_blank"
								>
									#{issue.number}
								</a>{" "}
								{issue.ready ? "ready" : "waiting"}
								{blockerSummary(issue.openBlockers)}
							</li>
						))}
					</ul>
				</section>
			)}
		</aside>
	);
}

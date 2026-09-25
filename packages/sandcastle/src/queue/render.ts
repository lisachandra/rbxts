/*
 * Queue views: compute the live READY/GATED state from the manifest plus fresh
 * GitHub data, flag drift, and render text or JSON. Pure — no I/O — so tests
 * can drive views from canned `LiveQueueState` fixtures.
 */

import type { LiveIssue, LiveQueueState } from "./live.js";
import { type QueueManifest, referencedIssues } from "./manifest.js";

export interface QueueIssueView {
	found: boolean;
	number: string;
	openBlockers: Array<string>;
	ready: boolean;
	state: LiveIssue["state"];
	title: string;
	wayfinder: boolean;
}

export interface QueueSequenceView {
	issues: Array<QueueIssueView>;
	mergeName: string | undefined;
	name: string;
	notes: string | undefined;
	reasons: Array<string>;
	status: "GATED" | "READY";
}

export interface QueueView {
	closed: Array<{ issue: string; where: string }>;
	drift: Array<string>;
	gated: Array<{
		issue: string;
		promotable: boolean;
		reason: string;
		state: undefined | LiveIssue["state"];
	}>;
	human: Array<{ issue: string; reason: string; state: undefined | LiveIssue["state"] }>;
	missing: Array<{ issue: string; where: string }>;
	rules: QueueManifest["serialized"];
	sequences: Array<QueueSequenceView>;
	unplaced: Array<{ number: string; title: string }>;
	/** Referenced issues that a truncated `gh issue list` page could not confirm either way. */
	unscanned: Array<{ issue: string; where: string }>;
	updated: string;
}

function viewFor(live: LiveQueueState, number: string): QueueIssueView {
	const issue = live.issues.get(number);
	return {
		found: issue?.found ?? false,
		number,
		openBlockers: issue?.openBlockers ?? [],
		ready: issue?.ready ?? false,
		state: issue?.state ?? "OPEN",
		title: issue?.title ?? "",
		wayfinder: issue?.wayfinder ?? false,
	};
}

/**
 * Computes the live queue view: per-sequence READY/GATED with reasons, gated entries with promotion
 * status, and every drift case the freshness pass used to do by hand (unplaced ready issues,
 * closed-but-listed, referenced-but-missing).
 *
 * @param manifest - The queue manifest.
 * @param live - Fresh GitHub state for the referenced numbers plus the ready backlog.
 * @param options - `strictGates` turns promotable gates into drift, so a stale gate fails a check
 *   instead of only printing a hint.
 */
export function computeQueueView(
	manifest: QueueManifest,
	live: LiveQueueState,
	options: { strictGates?: boolean } = {},
): QueueView {
	const sequences: Array<QueueSequenceView> = manifest.sequences.map((sequence) => {
		const issues = sequence.issues.map((number) => viewFor(live, number));
		const reasons: Array<string> = [];
		const members = new Set(sequence.issues);
		for (const issue of issues) {
			if (!issue.found) {
				reasons.push(`#${issue.number} not found on GitHub`);
				continue;
			}

			if (issue.state === "CLOSED") {
				reasons.push(`#${issue.number} closed`);
				continue;
			}

			if (!issue.ready) {
				reasons.push(`#${issue.number} missing ready-for-agent`);
				continue;
			}

			const external = issue.openBlockers.filter((blocker) => !members.has(blocker));
			if (external.length > 0) {
				const blockers = external.map((blocker) => `#${blocker}`).join(", ");
				reasons.push(`#${issue.number} blocked by open ${blockers}`);
			}
		}

		return {
			issues,
			mergeName: sequence.mergeName,
			name: sequence.name,
			notes: sequence.notes,
			reasons,
			status: reasons.length === 0 ? "READY" : "GATED",
		};
	});

	const gated = manifest.gated.map((entry) => {
		const issue = live.issues.get(entry.issue);
		const promotable =
			issue !== undefined &&
			issue.found &&
			issue.state === "OPEN" &&
			issue.ready &&
			issue.openBlockers.length === 0;
		return { issue: entry.issue, promotable, reason: entry.reason, state: issue?.state };
	});

	const human = manifest.human.map((entry) => {
		const issue = live.issues.get(entry.issue);
		return { issue: entry.issue, reason: entry.reason, state: issue?.state };
	});

	const closed: Array<{ issue: string; where: string }> = [];
	const missing: Array<{ issue: string; where: string }> = [];
	const unscanned: Array<{ issue: string; where: string }> = [];
	const inspectPlacement = (number: string, where: string, includeClosed: boolean): void => {
		const issue = live.issues.get(number);
		if (issue === undefined || !issue.found) {
			// A truncated page hides old issues; that is "not scanned", never "not found".
			if (live.truncated) {
				unscanned.push({ issue: number, where });
			} else {
				missing.push({ issue: number, where });
			}

			return;
		}

		if (includeClosed && issue.state === "CLOSED") {
			closed.push({ issue: number, where });
		}
	};

	for (const sequence of manifest.sequences) {
		for (const number of sequence.issues) {
			inspectPlacement(number, `sequence "${sequence.name}"`, true);
		}
	}

	for (const entry of manifest.gated) {
		inspectPlacement(entry.issue, "gated", true);
	}

	for (const entry of manifest.human) {
		inspectPlacement(entry.issue, "human", false);
	}

	const referenced = referencedIssues(manifest);
	const unplaced = live.readyIssues.filter((ready) => {
		const issue = live.issues.get(ready.number);
		if (issue?.wayfinder === true) {
			return false;
		}

		return !referenced.has(ready.number);
	});

	const drift: Array<string> = [];
	for (const item of unplaced) {
		drift.push(`#${item.number} is open and ready-for-agent but not placed in the queue`);
	}

	for (const item of closed) {
		drift.push(`#${item.issue} is referenced (${item.where}) but CLOSED`);
	}

	for (const item of missing) {
		drift.push(`#${item.issue} is referenced (${item.where}) but not found on GitHub`);
	}

	if (unscanned.length > 0) {
		drift.push(
			`${unscanned.length} referenced issue(s) were not scanned: gh issue list is capped at one page`,
		);
	}

	if (options.strictGates === true) {
		for (const entry of gated) {
			if (entry.promotable) {
				drift.push(`#${entry.issue} is gated but promotable — promote it or re-gate it`);
			}
		}
	}

	return {
		closed,
		drift,
		gated,
		human,
		missing,
		rules: manifest.serialized,
		sequences,
		unplaced,
		unscanned,
		updated: manifest.updatedAt,
	};
}

/** Renders the human-readable queue table (the visualization surface). */
export function renderQueueText(view: QueueView): string {
	const lines: Array<string> = [];
	lines.push(
		"── Sandcastle queue (live) ──",
		`  Manifest updated: ${view.updated === "" ? "never" : view.updated}`,
		"",
	);

	for (const sequence of view.sequences) {
		const icon = sequence.status === "READY" ? "✓" : "⏸";
		lines.push(
			`  ${icon} ${sequence.status.padEnd(5)}  ${sequence.name} (${sequence.issues.length} issue(s))`,
		);
		const list = sequence.issues.map((issue) => `#${issue.number}`).join(" ");
		const detail: Array<string> = [];
		if (sequence.mergeName !== undefined) {
			detail.push(`merge: ${sequence.mergeName}`);
		}

		detail.push(...sequence.reasons);
		if (detail.length === 0) {
			lines.push(`         ${list}`);
		} else {
			lines.push(`         ${list}`, `         ${detail.join(" · ")}`);
		}
	}

	if (view.rules.length > 0) {
		lines.push("");
		const ruleLines: Array<string> = ["  Serialization rules:"];
		for (const rule of view.rules) {
			const label =
				rule.name === undefined
					? `(${rule.issues.join(",")})`
					: `${rule.name} (${rule.issues.join(",")})`;
			ruleLines.push(`    ${label} — ${rule.reason}`);
		}

		lines.push(...ruleLines);
	}

	if (view.gated.length > 0) {
		const gatedLines: Array<string> = ["", "  Gated:"];
		for (const entry of view.gated) {
			gatedLines.push(`    #${entry.issue} — ${entry.reason}`);
		}

		const promotable = view.gated.filter((entry) => entry.promotable);
		if (promotable.length > 0) {
			gatedLines.push("", "  Promotable now (gated, conditions resolved):");
			for (const entry of promotable) {
				gatedLines.push(`    #${entry.issue} — open, ready-for-agent, no open blockers`);
			}
		}

		lines.push(...gatedLines);
	}

	if (view.human.length > 0) {
		const humanLines: Array<string> = ["", "  Human (never queued):"];
		for (const entry of view.human) {
			humanLines.push(`    #${entry.issue} (${entry.state ?? "?"}) — ${entry.reason}`);
		}

		lines.push(...humanLines);
	}

	if (view.unscanned.length > 0) {
		const unscannedLines: Array<string> = ["", "  Unscanned (issue list truncated):"];
		for (const entry of view.unscanned) {
			unscannedLines.push(`    ? #${entry.issue} (${entry.where})`);
		}

		lines.push(...unscannedLines);
	}

	if (view.drift.length > 0) {
		const driftLines: Array<string> = ["", "  Drift:"];
		for (const line of view.drift) {
			driftLines.push(`    ✗ ${line}`);
		}

		lines.push(...driftLines);
	}

	return lines.join("\n");
}

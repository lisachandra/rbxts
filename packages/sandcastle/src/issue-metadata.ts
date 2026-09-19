/*
 * Issue metadata seam.
 *
 * Owns the single `gh issue view` data fetch for an issue's title and labels.
 * `issueMetadata` accepts an injectable `gh` runner so tests can pass canned
 * output or failure without spawning the CLI; production uses `io.execSync` at
 * the repository root. `issueView` and `fetchIssueLabels` remain supported for
 * backwards compatibility.
 */

import { config, io, repoRoot } from "./runtime.js";

const issueViewCommand = config.issueCommand;

export interface IssueMetadata {
	labels: Array<string>;
	title: string;
}

export type GhRunner = (command: string) => string;

/** Returns the configured issue-view command with `{issue}` replaced. */
export function issueView(issueNumber: string): string {
	return issueViewCommand.replaceAll("{issue}", issueNumber);
}

const defaultGhRunner: GhRunner = (cmd: string) =>
	io.execSync(cmd, { cwd: repoRoot, encoding: "utf-8" }).toString();

/**
 * Fetches an issue's title and labels through the `gh` seam.
 *
 * @param issueNumber - The GitHub issue number to look up.
 * @param gh - Optional runner executing `gh` commands; defaults to `io.execSync`.
 * @returns `{ title, labels }`; falls back to `{ title: "(could not fetch)", labels: [] }` when
 *   `gh` throws or returns malformed data.
 */
export function issueMetadata(issueNumber: string, gh: GhRunner = defaultGhRunner): IssueMetadata {
	try {
		const output = gh(`${issueView(issueNumber)} --json title,labels`);
		const payload = JSON.parse(output) as {
			labels?: Array<{ name?: string }>;
			title?: string;
		};
		const title = (payload.title ?? "").trim() || "(could not fetch)";
		const labels = (payload.labels ?? [])
			.map((label) => label.name ?? "")
			.filter((name) => name !== "");
		return { labels, title };
	} catch {
		return { labels: [], title: "(could not fetch)" };
	}
}

/** Fetches an issue's labels through `issueMetadata` (backwards-compatible). */
export function fetchIssueLabels(
	issueNumber: string,
	gh: GhRunner = defaultGhRunner,
): Array<string> {
	return issueMetadata(issueNumber, gh).labels;
}

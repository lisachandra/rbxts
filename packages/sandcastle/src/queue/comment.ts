/*
 * Sticky queue-graph comments.
 *
 * `queue graph --comment <n>` keeps exactly one graph on a tracker issue: the marker comment in the
 * rendered page identifies it, so a re-run PATCHes the comment it wrote last time instead of
 * stacking a new one on every render. Reads and writes go through a `gh api` seam so tests can
 * drive both without spawning the CLI.
 */

import { io, repoRoot } from "../runtime.js";
import { queueGraphCommentMarker } from "./graph.js";

/** `gh api` seam: runs the subcommand with the given arguments and returns stdout. */
export type GhApiRunner = (args: ReadonlyArray<string>) => string;

function defaultGhApi(args: ReadonlyArray<string>): string {
	return io.execFileSync("gh", ["api", ...args], { cwd: repoRoot, encoding: "utf-8" }).toString();
}

/** The `--jq` filter selecting the graph comments; `contains` tolerates older marker placement. */
const markerFilter = `.[] | select(.body | contains("${queueGraphCommentMarker}")) | .id`;

function commentIds(ghApi: GhApiRunner, repository: string, issue: string): Array<string> {
	const output = ghApi([
		`repos/${repository}/issues/${issue}/comments`,
		"--paginate",
		"--jq",
		markerFilter,
	]);
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

export interface GraphCommentParams {
	/** Markdown page to post, marker line included. */
	body: string;
	/** `gh api` seam; defaults to the real CLI. */
	ghApi?: GhApiRunner;
	/** Issue number the graph belongs on. */
	issue: string;
	/** Repository slug, `owner/name`. */
	repository: string;
}

/**
 * - Posts the rendered graph, or updates the comment a previous render left behind.
 * - @param params - Issue number, Markdown body, and the `gh api` seam.
 * - @returns `"created"` when a comment was posted, `"updated"` when the existing one was patched.
 * - @remarks The newest marker comment wins when the API returns several (a hand-created duplicate,
 *   or a marker that moved): patching the last one converges the issue on a single graph.
 * - @throws {Error} When `gh` fails; the error is the CLI's own, naming the endpoint it could not
 *   reach.
 */
export function upsertGraphComment(params: GraphCommentParams): "created" | "updated" {
	const ghApi = params.ghApi ?? defaultGhApi;
	const existing = commentIds(ghApi, params.repository, params.issue).at(-1);
	if (existing === undefined) {
		ghApi([
			`repos/${params.repository}/issues/${params.issue}/comments`,
			"-f",
			`body=${params.body}`,
		]);
		return "created";
	}

	ghApi([
		`repos/${params.repository}/issues/comments/${existing}`,
		"-X",
		"PATCH",
		"-f",
		`body=${params.body}`,
	]);
	return "updated";
}

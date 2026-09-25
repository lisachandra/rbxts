/*
 * Live GitHub state for queue rendering.
 *
 * The queue manifest never stores issue state; it is fetched live on every
 * `queue list` / `queue check`. Two `gh` calls:
 * 1. `gh issue list --state all` — state, title, labels for every issue (also
 *    drives "unplaced ready-for-agent issue" detection).
 * 2. One batched GraphQL call — `blockedBy` edges for the referenced issues
 *    (the REST list payload does not carry them).
 */

import { z } from "zod";

import type { GhRunner } from "../issue-metadata.js";
import { io, repoRoot } from "../runtime.js";

export interface LiveIssue {
	found: boolean;
	number: string;
	/** Numbers of blockers whose issue is still OPEN. */
	openBlockers: Array<string>;
	ready: boolean;
	state: "OPEN" | "CLOSED";
	title: string;
	wayfinder: boolean;
}

export interface LiveQueueState {
	/** Live state for every referenced issue number. */
	issues: Map<string, LiveIssue>;
	/** Every open, ready-for-agent issue in the repository (drives unplaced detection). */
	readyIssues: Array<{ number: string; title: string }>;
	/**
	 * True when `gh issue list` returned a full page, so issues older than the page are absent from
	 * `issues` rather than deleted. Drives "not scanned" instead of "not found" below.
	 */
	truncated: boolean;
}

const issueListSchema = z.array(
	z.object({
		labels: z
			.array(z.object({ name: z.string().optional() }).nullish())
			.nullish()
			.transform((labels) =>
				(labels ?? []).map((label) => label?.name ?? "").filter(Boolean),
			),
		number: z.number(),
		state: z.string(),
		title: z
			.string()
			.nullish()
			.transform((title) => title ?? ""),
	}),
);

const graphqlResponseSchema = z.object({
	data: z
		.object({
			repository: z.record(z.string(), z.unknown()).nullish(),
		})
		.nullish(),
});

const issueNodeSchema = z.object({
	blockedBy: z
		.object({
			nodes: z
				.array(
					z
						.object({
							number: z.number(),
							state: z
								.string()
								.nullish()
								.transform((state) => state ?? ""),
						})
						.nullish(),
				)
				.nullish(),
		})
		.nullish()
		.optional(),
	number: z.number(),
	state: z
		.string()
		.nullish()
		.transform((state) => state ?? ""),
});

const defaultGhRunner: GhRunner = (command) =>
	io.execSync(command, { cwd: repoRoot, encoding: "utf-8" }).toString();

function defaultGraphqlRunner(query: string): string {
	return io
		.execFileSync("gh", ["api", "graphql", "-f", `query=${query}`], {
			cwd: repoRoot,
			encoding: "utf-8",
		})
		.toString();
}

export interface FetchLiveQueueStateParams {
	/** Subcommand seam for `gh` shell commands (`gh issue list`, `gh repo view`). */
	gh?: GhRunner;
	graphql?: (query: string) => string;
	numbers: ReadonlySet<string>;
	readyLabel: string;
}

/**
 * Fetches live issue state for the referenced numbers plus the repository-wide open/ready list.
 *
 * @throws {Error} When `gh` fails or returns payloads that cannot be parsed.
 */
export function fetchLiveQueueState(params: FetchLiveQueueStateParams): LiveQueueState {
	const gh = params.gh ?? defaultGhRunner;
	const graphql = params.graphql ?? defaultGraphqlRunner;

	// Single page: a full page means older issues were not returned, so absence is not deletion.
	const issueListLimit = 1000;

	let listPayload: unknown;
	try {
		listPayload = JSON.parse(
			gh(
				`gh issue list --state all --limit ${issueListLimit} --json number,state,title,labels`,
			),
		) as unknown;
	} catch (err) {
		throw new Error(`Could not list repository issues via gh: ${String(err)}`);
	}

	const parsedList = issueListSchema.safeParse(listPayload);
	if (!parsedList.success) {
		throw new Error(
			`gh issue list returned an unexpected payload: ${parsedList.error.message}`,
		);
	}

	// A full page means older issues are missing from the payload, not deleted from the repo.
	const truncated = parsedList.data.length >= issueListLimit;

	const issues = new Map<string, LiveIssue>();
	const readyIssues: Array<{ number: string; title: string }> = [];

	for (const raw of parsedList.data) {
		const number = String(raw.number);
		const labelNames = raw.labels;
		const live: LiveIssue = {
			found: true,
			number,
			openBlockers: [],
			ready: labelNames.includes(params.readyLabel),
			state: raw.state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN",
			title: raw.title,
			wayfinder: labelNames.some((label) => label.startsWith("wayfinder:")),
		};

		issues.set(number, live);
		if (live.state === "OPEN" && live.ready) {
			readyIssues.push({ number, title: live.title });
		}
	}

	const referenced = [...params.numbers].filter((number) => issues.has(number));
	if (referenced.length > 0) {
		const repoIdentifiers = parseRepositoryIdentifiers(gh);
		const query = buildBlockedByQuery(repoIdentifiers.owner, repoIdentifiers.name, referenced);
		let graphqlPayload: unknown;
		try {
			graphqlPayload = JSON.parse(graphql(query)) as unknown;
		} catch (err) {
			throw new Error(`Could not fetch blocked-by edges via gh graphql: ${String(err)}`);
		}

		const parsedGraphql = graphqlResponseSchema.safeParse(graphqlPayload);
		if (!parsedGraphql.success) {
			throw new Error(
				`gh graphql returned an unexpected payload: ${parsedGraphql.error.message}`,
			);
		}

		const repository = parsedGraphql.data.data?.repository;
		for (const number of referenced) {
			const node =
				repository === undefined || repository === null
					? undefined
					: repository[`i${number}`];
			const parsedNode = issueNodeSchema.safeParse(node);
			if (!parsedNode.success || parsedNode.data === undefined || parsedNode.data === null) {
				continue;
			}

			const issue = issues.get(number);
			if (issue === undefined) {
				continue;
			}

			const blocked = parsedNode.data.blockedBy?.nodes ?? [];
			issue.openBlockers = blocked
				.filter((edge) => edge?.state.toUpperCase() === "OPEN")
				.map((edge) => String(edge?.number ?? ""));
			// The GraphQL state is authoritative for referenced issues.
			issue.state = parsedNode.data.state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
		}
	}

	return { issues, readyIssues, truncated };
}

function parseRepositoryIdentifiers(gh: GhRunner): { name: string; owner: string } {
	let output: string;
	try {
		output = gh("gh repo view --json nameWithOwner --jq .nameWithOwner").trim();
	} catch (err) {
		throw new Error(`Could not resolve the repository for gh graphql: ${String(err)}`);
	}

	const [owner, name] = output.split("/");
	if (owner === undefined || owner === "" || name === undefined || name === "") {
		throw new Error(`Could not resolve the repository from gh output: "${output}"`);
	}

	return { name, owner };
}

function buildBlockedByQuery(owner: string, name: string, numbers: ReadonlyArray<string>): string {
	const body = numbers
		.map((number) => {
			return `i${number}: issue(number: ${number}) { number state blockedBy(first: 50) { nodes { number state } } }`;
		})
		.join(" ");
	return `query { repository(owner: "${owner}", name: "${name}") { ${body} } }`;
}

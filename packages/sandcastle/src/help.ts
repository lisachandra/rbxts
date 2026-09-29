/*
 * Help topics: one focused block per command and queue subcommand.
 *
 * The global help is an index of twenty-odd commands, which is the wrong answer to `queue add
 * --help`. Topics are data rather than branches, so `helpTopicKey` is a pure function of the parsed
 * options and every command can be covered by a table-driven test.
 */

import type { CliOptions } from "./cli.js";

export interface HelpTopic {
	/** Flag lines, already aligned. */
	flags?: Array<string>;
	/** Behaviour worth stating up front: exit codes, side effects, prerequisites. */
	notes?: Array<string>;
	/** Usage lines, most common first. */
	usage: Array<string>;
}

const topics = {
	"add": {
		flags: [
			"--issue <n>        Issue number (required)",
			"--sequence <name>  Batch to place it in",
			"--after <m>        Insert after member <m> instead of appending",
			"--gated            Cannot start until --reason is resolved",
			"--human            Never queued; needs a human decision session",
			"--reason <text>    Why the issue is gated or human",
			"--joins <batch>    Batch it joins once its gate clears",
		],
		notes: [
			"Requires exactly one of --sequence, --gated, or --human.",
			"--joins records the batch a gated issue moves into; promote prefers it over the title scope.",
		],
		usage: [
			"pnpm sandcastle queue add --issue <n> --sequence <batch> [--after <m>]",
			'pnpm sandcastle queue add --issue <n> --gated --reason "<blocking condition>"',
			'pnpm sandcastle queue add --issue <n> --human --reason "<decision needed>"',
		],
	},
	"bootstrap": {
		flags: [
			"--apply    Write the proposal to the manifest (default: print it only)",
			"--dry-run  Resolve and report without writing",
		],
		notes: [
			"Groups the unplaced ready-for-agent backlog by the conventional scope in each title.",
			"wayfinder:* tickets become --human entries; issues with open blockers become --gated.",
			"Scopes that already have a sequence are skipped rather than merged.",
		],
		usage: ["pnpm sandcastle queue bootstrap [--apply] [--dry-run]"],
	},
	"check": {
		flags: [
			"--json  Machine-readable queue view",
			"--strict-gates  Count a promotable gate as drift",
		],
		notes: [
			"Exit 0: no drift. Exit 1: drift. Exit 2: --strict-gates found more than the relaxed pass.",
			"Safe to run after any review that filed follow-up issues.",
		],
		usage: ["pnpm sandcastle queue check [--json] [--strict-gates]"],
	},
	"graph": {
		flags: [
			"--format <mermaid|json|ascii>  Rendering to print; Mermaid by default",
			"--expand-issues          Draw each batch as a subgraph of its member issues",
			"--write <path>           Write the Markdown page instead of printing",
			"--comment <n>            Post or update the sticky graph comment on issue n",
		],
		notes: [
			"Read-only: the only view that shows run order, gate kind, and rule edges together.",
			"Mermaid renders natively on GitHub, and --write output carries no timestamp, so a committed",
			"copy can be diffed for schedule drift.",
			"--comment finds its previous comment by marker and PATCHes it, keeping one graph per issue.",
		],
		usage: [
			"pnpm sandcastle queue graph [--format <mermaid|json|ascii>] [--expand-issues]",
			"pnpm sandcastle queue graph --write docs/queue.md",
			"pnpm sandcastle queue graph --comment <issue>",
		],
	},
	"integration-abort": {
		flags: ["--name <name>  Integration name (required)"],
		notes: ["Deletes the integration worktree and its state."],
		usage: ["pnpm sandcastle integration-abort --name <name>"],
	},
	"integration-cleanup": {
		flags: [
			"--force  Allow cleanup of a dirty worktree",
			"--name <name>  Integration name (required)",
		],
		usage: ["pnpm sandcastle integration-cleanup --name <name> [--force]"],
	},
	"integration-resume": {
		flags: [
			"--name <name>         Integration name (required)",
			"--quarantine-drift    Stash uncommitted worktree drift instead of failing",
		],
		notes: ["Shares the agent, effort, model, and setup flags listed under the global help."],
		usage: ["pnpm sandcastle integration-resume --name <name> [options]"],
	},
	"integration-status": {
		flags: ["--name <name>  Integration name (required)"],
		notes: ["Prints the state machine position and any blocked reason; read-only."],
		usage: ["pnpm sandcastle integration-status --name <name>"],
	},
	"issue": {
		flags: [
			"-i, --issue <n>      Issue number, or all",
			"-c, --concurrency <n>  Max parallel issues for all (default: 1)",
			"--resume             Resume from the last incomplete phase",
			"--phase <phase>      Run one phase (design | implement | review)",
			"--force [phase]      Force a re-run of a phase",
			"--status             Print phase evaluation without running",
			"--worktree <path>    Use an existing registered worktree",
		],
		notes: ["--issue all plans the ready-for-agent backlog and dispatches what is unblocked."],
		usage: [
			"pnpm sandcastle issue --issue <number> [options]",
			"pnpm sandcastle issue --issue all",
		],
	},
	"issue-sequence": {
		flags: [
			"--sequential <ids>  Comma-separated issue numbers, in order (required)",
			"--base <ref>        Starting ref (default: main)",
			"--worktree <path>   Append in an existing worktree",
		],
		notes: [
			"Runs issues in order; earlier commits are the base of the next issue.",
			"Aborts when an issue concludes blocked.",
		],
		usage: ["pnpm sandcastle issue-sequence --sequential 151,150,147 [--base main] [options]"],
	},
	"land": {
		flags: [
			"--name <batch>  Batch to compose (required)",
			"--create-pr     Push the branch and open the PR (default: print the commands)",
			"--finish        Drop the batch once GitHub has closed every member",
			"--dry-run       Report the landing without composing",
		],
		notes: [
			"Composes the batch on sandcastle/integration/<name>: merges every member, resolves",
			"conflicts, and reviews the result. Safe to re-run — an unfinished composition resumes.",
			"The PR body carries one `Closes #<n>` per member, so merging the PR closes them all.",
			"Merging is the human gate: batches whose `after` names this one stay GATED until the",
			"integration is an ancestor of the base branch.",
			"For anything other than a queue batch, use `sandcastle merge`.",
		],
		usage: [
			"pnpm sandcastle queue land --name <batch> [--create-pr]",
			"pnpm sandcastle queue land --name <batch> --finish",
		],
	},

	"list": {
		flags: [
			"--json  Machine-readable queue view",
			"--strict-gates  Count a promotable gate as drift",
		],
		notes: ["Read-only: fetches live issue state and never writes the manifest."],
		usage: ["pnpm sandcastle queue list [--json] [--strict-gates]"],
	},
	"migrate": {
		flags: [
			"--assign <old>=<name>,...  Integration name for a batch a v1 manifest left unnamed",
			"--apply                    Write the result (default: print the proposal)",
			"--dry-run                  Report without writing",
		],
		notes: [
			"Translates a v1 manifest to v2: the short code and the separate mergeName collapse into",
			"one integration name, and afterMerge becomes after.",
			"Refuses to guess: batches with no name need an explicit --assign entry.",
			"A fold target that no longer exists (the batches were already folded) is reported, not",
			"treated as an error.",
		],
		usage: [
			"pnpm sandcastle queue migrate [--apply] [--dry-run]",
			"pnpm sandcastle queue migrate --assign V3=vfx-mounts-work --apply",
		],
	},

	"merge": {
		flags: [
			"--name <branch>     Integration branch name (required)",
			"--issues <a,b,c>    Tail issue of each sequence (required)",
			"--base <ref>        Merge base (default: main)",
			"--allow-unreviewed  Allow sources whose review is incomplete",
			"--quarantine-drift  Stash uncommitted worktree drift instead of failing",
		],
		notes: ["`queue run` prints the tail issue to use here when a batch lands."],
		usage: ["pnpm sandcastle merge --name <name> --issues <tail,tail> [--base main]"],
	},
	"merge-integrations": {
		flags: [
			"--name <name>          Target integration name (required)",
			"--integrations <a,b>   Source integrations (required)",
			"--base <ref>           Merge base (default: main)",
		],
		usage: [
			"pnpm sandcastle merge-integrations --name <name> --integrations a,b [--base main]",
		],
	},
	"promote": {
		flags: [
			"--apply            Promote every promotable gate (default: one --issue)",
			"--issue <n>        Promote this gate",
			"--sequence <name>  Target sequence (default: the scope in the issue title)",
		],
		notes: [
			"Promotable = open, ready-for-agent, and no open blocker left.",
			"An issue that is not gated, or still blocked, is refused; use queue add to place it.",
		],
		usage: [
			"pnpm sandcastle queue promote --apply",
			"pnpm sandcastle queue promote --issue <n> [--sequence <batch>]",
		],
	},
	"prune": {
		flags: [
			"--closed   Prune references to CLOSED issues (required to act)",
			"--json     Machine-readable report",
		],
		notes: [
			"A closed issue in a batch gates it forever; this is the CLI exit for that state.",
			"`human` entries are never pruned — a finished decision session is still a record.",
			"Referenced-but-missing issues stay as drift; investigate those by hand.",
		],
		usage: ["pnpm sandcastle queue prune --closed [--json] [--dry-run]"],
	},
	"queue": {
		flags: [
			"--json  Machine-readable output where the subcommand supports it",
			"--queue  Force the queue workflow on for this invocation",
			"--no-queue  Bypass the queue workflow for this invocation",
			"--queue-commit  Commit the manifest after a mutation (never pushes)",
			"--strict-gates  Count a promotable gate as drift (list, check)",
		],
		notes: [
			"GitHub issues stay canonical for issue state; the manifest (sandcastle.queue.json, git",
			"tracked) records only what GitHub cannot express: batch composition and run order,",
			"serialization rules, and gates. It lives in the primary checkout, so a review running in",
			"a worktree registers follow-ups in the real queue.",
		],
		usage: [
			"pnpm sandcastle queue <subcommand> [options]",
			"",
			"Subcommands:",
			"  add        Place an issue in a batch, a gate, or the human bucket",
			"  bootstrap  Propose placements for the unplaced ready backlog",
			"  check      Exit non-zero while the queue and GitHub disagree",
			"  graph      Render the run order as a Mermaid diagram (or json/ascii)",
			"  land       Compose a batch and open its PR (the human merge gate)",
			"  list       Live READY/GATED view plus drift",
			"  migrate    Translate a v1 manifest to v2",
			"  prune      Drop references to closed issues",
			"  remove     Take an issue out of every placement",
			"  rule       Declare a same-file serialization rule (R<n>)",
			"  run        Fire the next READY batch",
			"  sequence   Define or replace a batch",

			"  serve      Serve the graph as a local page (--port, --host, --open)",
		],
	},
	"remove": {
		flags: ["--issue <n>  Issue number (required)"],
		notes: ["The deliberate move between batches; `prune` handles the mechanical case."],
		usage: ["pnpm sandcastle queue remove --issue <n>"],
	},
	"rule": {
		flags: [
			"--issues <a,b>   Issues that must never be in flight together (required)",
			"--reason <text>  Why (required)",
			"--name <R#>      Rule name, e.g. R2",
		],
		notes: [
			"`queue run` never dispatches a batch that shares a rule with an already-dispatched issue.",
		],
		usage: ["pnpm sandcastle queue rule [--name <R#>] --issues <a,b> --reason <text>"],
	},
	"run": {
		flags: [
			"--name <batch>     Restrict dispatch to one batch",
			"--max-issues <n>   Stop after dispatching n issues",
			"--keep-entries     Keep landed entries instead of pruning them",
			"--json             One JSON object per decision (JSONL)",
			"--dry-run          Print the decision without dispatching",
			"--land             Compose each dispatched batch when it finishes",
			"--create-pr        With --land, push the branch and open the PR",
		],
		notes: [
			"Re-reads the manifest and live GitHub state after every batch: a review that registered a",
			"follow-up changes what runs next inside the same invocation.",
			"Exit 1 when nothing can fire — an unknown --name, or no READY batch.",
			"Landed entries (issue closed and review APPROVED) are pruned unless --keep-entries.",
			"The landing hint prints the exact `queue land --name <batch>` line for each batch.",
			"A batch is landed once, by a human: `queue land` composes it, the PR is merged by hand.",
		],
		usage: [
			"pnpm sandcastle queue run [--name <batch>] [--max-issues <n>] [--keep-entries] [--land]",
		],
	},
	"sequence": {
		flags: [
			"--name <batch>       Integration name (required): the batch IS this name",
			"--issues <a,b,c>     Members in run order (required)",
			"--title <label>      Short human label shown by `queue list`",
			"--roles <n=role,...> Per-issue role phrases, e.g. 382=shell,383=pause",
			"--after <batch>      Stay GATED until that integration lands on the base branch",
			"--notes <text>       Ordering rationale, kept in the manifest",
			"--before <batch>     Place this batch ahead of that one",
			"--delete             Drop the batch; --issues is not required",
			"--last               Move the batch to the end of the run order",
		],
		notes: [
			"Replaces a batch of the same name; positions satisfy intra-batch dependencies.",
			"Every batch is built from the base ref, so members never stack on an unlanded batch.",
			"Omitted --title/--roles/--notes/--after keep what the batch already had.",
			"Run order is the array order: a redefinition keeps its position unless --before or --last moves it.",
			"--after is a run-order gate: the batch stays GATED until that integration lands on the base",
			"branch. The gate clears itself; nothing has to un-gate it by hand.",
			"Deleting a batch another one waits on is refused until you re-point the `after`.",
		],
		usage: [
			"pnpm sandcastle queue sequence --name <batch> --issues <a,b,c> [--title <label>]",
			"pnpm sandcastle queue sequence --name <batch> --issues <a,b,c> [--after <batch>]",
			"pnpm sandcastle queue sequence --name <batch> --delete",
		],
	},
	"serve": {
		flags: [
			"--port <n>   Port to bind (default 4321; 0 asks for a free one)",
			"--host <ip>  Address to bind (default 127.0.0.1, loopback only)",
			"--open       Open the page in the default browser",
		],
		notes: [
			"Read-only and local: the same graph `queue graph` renders, with layers, filters, and a",
			"detail panel for the batch you click.",
			"Reads the manifest and live GitHub state on first request and caches for 30s; the page's",
			"Refresh button sends ?refresh=1 to bypass it, so refreshing never burns `gh` calls.",
		],
		usage: ["pnpm sandcastle queue serve [--port <n>] [--host <ip>] [--open]"],
	},

	"setup": {
		flags: [
			"--worktree <path>  Prepare this worktree",
			"--branch <name>    Create or reuse the worktree for this branch",
			"--base <ref>       Base for a new branch",
		],
		notes: [
			"No flags prepares the current directory (e.g. a clean paseo worktree).",
			"Idempotent: creates state dirs, copies .env, runs setupCommands, links symlinks.",
		],
		usage: [
			"pnpm sandcastle setup [--worktree <path>]",
			"pnpm sandcastle setup --branch <name> [--base <ref>]",
		],
	},
} satisfies Record<string, HelpTopic>;

export type HelpTopicKey = keyof typeof topics;

/** Resolves the topic a `--help` invocation asks about; `undefined` means the global index. */
export function helpTopicKey(options: CliOptions): undefined | HelpTopicKey {
	if (options.command === "queue") {
		return options.queueSubcommand ?? "queue";
	}

	return isHelpTopicKey(options.command) ? options.command : undefined;
}

export function isHelpTopicKey(value: string): value is HelpTopicKey {
	return Object.hasOwn(topics, value);
}

/** Topics addressed as `queue <key>`; everything else is a top-level command. */
const queueTopics: ReadonlySet<string> = new Set([
	"add",
	"bootstrap",
	"check",
	"graph",
	"land",
	"list",
	"migrate",
	"promote",
	"prune",
	"queue",
	"remove",
	"rule",
	"run",
	"sequence",

	"serve",
]);

function titleFor(key: HelpTopicKey): string {
	if (!queueTopics.has(key)) {
		return `Sandcastle ${key}`;
	}

	return key === "queue" ? "Sandcastle queue" : `Sandcastle queue ${key}`;
}

/** Renders one topic: usage, flags, notes, then a pointer to the global index. */
export function renderHelpTopic(key: HelpTopicKey): string {
	const topic: HelpTopic = topics[key];
	const lines = [titleFor(key), "", "Usage:"];
	for (const line of topic.usage) {
		lines.push(line === "" ? "" : `  ${line}`);
	}

	if (topic.flags !== undefined) {
		lines.push("", "Options:");
		for (const flag of topic.flags) {
			lines.push(`  ${flag}`);
		}
	}

	if (topic.notes !== undefined) {
		lines.push("");
		for (const note of topic.notes) {
			lines.push(`  ${note}`);
		}
	}

	lines.push("", "Global index: pnpm sandcastle --help");
	return lines.join("\n");
}

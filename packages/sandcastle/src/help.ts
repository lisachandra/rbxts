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
		],
		notes: ["Requires exactly one of --sequence, --gated, or --human."],
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
	"list": {
		flags: [
			"--json  Machine-readable queue view",
			"--strict-gates  Count a promotable gate as drift",
		],
		notes: ["Read-only: fetches live issue state and never writes the manifest."],
		usage: ["pnpm sandcastle queue list [--json] [--strict-gates]"],
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
			"  list       Live READY/GATED view plus drift",
			"  prune      Drop references to closed issues",
			"  remove     Take an issue out of every placement",
			"  rule       Declare a same-file serialization rule (R<n>)",
			"  run        Fire the next READY batch",
			"  sequence   Define or replace a batch",
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
		],
		notes: [
			"Re-reads the manifest and live GitHub state after every batch: a review that registered a",
			"follow-up changes what runs next inside the same invocation.",
			"Exit 1 when nothing can fire — an unknown --name, or no READY batch.",
			"Landed entries (issue closed and review APPROVED) are pruned unless --keep-entries.",
			"The merge hint prints the tail issue to hand to `sandcastle merge`.",
		],
		usage: [
			"pnpm sandcastle queue run [--name <batch>] [--max-issues <n>] [--keep-entries] [--dry-run]",
		],
	},
	"sequence": {
		flags: [
			"--name <batch>       Batch name (required)",
			"--issues <a,b,c>     Members in run order (required)",
			"--merge-name <branch>  Integration branch used by `sandcastle merge`",
			"--notes <text>       Ordering rationale, kept in the manifest",
		],
		notes: ["Replaces a batch of the same name; positions satisfy intra-batch dependencies."],
		usage: [
			"pnpm sandcastle queue sequence --name <batch> --issues <a,b,c> [--merge-name <branch>]",
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
	"list",
	"promote",
	"prune",
	"queue",
	"remove",
	"rule",
	"run",
	"sequence",
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

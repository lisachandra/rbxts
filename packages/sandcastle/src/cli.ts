/*
 * CLI argument parsing and help text.
 *
 * Precedence for agent/model/effort: explicit flags win, then the repo's
 * sandcastle.config.ts, then the deprecated environment variables (which print
 * a warning in main()).
 */

import { resolve as pathResolve } from "node:path";

import { config } from "./runtime.js";
import type { AgentBackend, PhaseName, SandcastleEffort } from "./types.js";

export type CliCommand =
	| "issue"
	| "merge"
	| "issue-sequence"
	| "integration-abort"
	| "merge-integrations"
	| "integration-status"
	| "integration-resume"
	| "integration-cleanup";

export interface CliOptions {
	readonly agentBackend: AgentBackend;
	readonly allowUnreviewed: boolean;
	readonly base: string;
	readonly command: CliCommand;
	readonly concurrency: number;
	readonly dryRun: boolean;
	readonly effort: SandcastleEffort;
	readonly force?: true | PhaseName;
	readonly help: boolean;
	readonly ignoreSetup?: boolean;
	readonly integrationName?: string;
	readonly integrationNames: Array<string>;
	readonly issueNumber: string;
	readonly issueNumbers: Array<string>;
	readonly maxImplementIterations: number;
	readonly model: string;
	readonly phase?: PhaseName;
	readonly resume: boolean;
	readonly sequentialIssues: Array<string>;
	readonly status: boolean;
	readonly worktree?: string;
}

export function commaSeparated(value: string | undefined, flag: string): Array<string> {
	if (value === undefined || value === "") {
		throw new Error(`${flag} requires a value`);
	}

	const values = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	if (values.length === 0) {
		throw new Error(`${flag} requires at least one value`);
	}

	return values;
}

interface ParsedArgState {
	agentBackend: AgentBackend;
	allowUnreviewed: boolean;
	base: string;
	command: CliCommand;
	concurrency: number;
	dryRun: boolean;
	effort: SandcastleEffort;
	force: true | PhaseName | undefined;
	help: boolean;
	ignoreSetup: boolean;
	integrationName: string | undefined;
	integrationNames: Array<string>;
	issueNumber: string | undefined;
	issueNumbers: Array<string>;
	maxImplementIterations: number;
	model: string | undefined;
	phase: PhaseName | undefined;
	resume: boolean;
	sequentialIssues: Array<string>;
	status: boolean;
	worktree: string | undefined;
}

function createParsedArgState(): ParsedArgState {
	return {
		agentBackend: config.agents.default,
		allowUnreviewed: false,
		base: config.baseBranch,
		command: "issue",
		concurrency: 1,
		dryRun: false,
		effort: config.effort,
		force: undefined,
		help: false,
		ignoreSetup: false,
		integrationName: undefined,
		integrationNames: [],
		issueNumber: undefined,
		issueNumbers: [],
		maxImplementIterations: 100,
		model: undefined,
		phase: undefined,
		resume: false,
		sequentialIssues: [],
		status: false,
		worktree: undefined,
	};
}

function isPhaseName(value: string | undefined): value is PhaseName {
	return value === "design" || value === "implement" || value === "review";
}

function isAgentBackend(value: string | undefined): value is AgentBackend {
	return value === "dirac" || value === "pi";
}

function isSandcastleEffort(value: string | undefined): value is SandcastleEffort {
	return (
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
	);
}

function isIntegrationCommand(value: string): value is CliCommand {
	return (
		value === "merge" ||
		value === "merge-integrations" ||
		value === "issue-sequence" ||
		value === "integration-status" ||
		value === "integration-resume" ||
		value === "integration-abort" ||
		value === "integration-cleanup"
	);
}

type ArgHandler = (state: ParsedArgState, next: string | undefined, index: number) => number;

const valueArgHandlers: Record<string, ArgHandler> = {
	"--agent": (state, next, index) => {
		if (!isAgentBackend(next)) {
			throw new Error("--agent must be one of: dirac, pi");
		}

		state.agentBackend = next;
		return index + 1;
	},
	"--base": (state, next, index) => {
		state.base = next ?? state.base;
		return index + 1;
	},
	"--concurrency": (state, next, index) => {
		state.concurrency = Math.max(1, Number(next ?? "1"));
		return index + 1;
	},
	"--effort": (state, next, index) => {
		if (!isSandcastleEffort(next)) {
			throw new Error("--effort must be one of: low, medium, high, xhigh, max");
		}

		state.effort = next;
		return index + 1;
	},
	"--force": (state, next, index) => {
		if (isPhaseName(next)) {
			state.force = next;
			return index + 1;
		}

		state.force = true;
		return index;
	},
	"--integrations": (state, next, index) => {
		state.integrationNames.push(...commaSeparated(next, "--integrations"));
		return index + 1;
	},
	"--issue": (state, next, index) => {
		state.issueNumber = next;
		return index + 1;
	},
	"--issues": (state, next, index) => {
		state.issueNumbers.push(...commaSeparated(next, "--issues"));
		return index + 1;
	},
	"--max-iterations": (state, next, index) => {
		state.maxImplementIterations = Number(next ?? "100");
		return index + 1;
	},
	"--model": (state, next, index) => {
		state.model = next;
		return index + 1;
	},
	"--name": (state, next, index) => {
		state.integrationName = next;
		return index + 1;
	},
	"--phase": (state, next, index) => {
		if (!isPhaseName(next)) {
			throw new Error("--phase must be one of: design, implement, review");
		}

		state.phase = next;
		return index + 1;
	},
	"--sequential": (state, next, index) => {
		state.sequentialIssues.push(...commaSeparated(next, "--sequential"));
		return index + 1;
	},
	"--worktree": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--worktree requires an existing path");
		}

		state.worktree = pathResolve(next);
		return index + 1;
	},
	"-c": (state, next, index) => {
		state.concurrency = Math.max(1, Number(next ?? "1"));
		return index + 1;
	},
	"-i": (state, next, index) => {
		state.issueNumber = next;
		return index + 1;
	},
};

const booleanArgHandlers: Record<string, (state: ParsedArgState) => void> = {
	"--allow-unreviewed": (state) => {
		state.allowUnreviewed = true;
	},
	"--dry-run": (state) => {
		state.dryRun = true;
	},
	"--help": (state) => {
		state.help = true;
	},
	"--ignore-setup": (state) => {
		state.ignoreSetup = true;
	},
	"--resume": (state) => {
		state.resume = true;
	},
	"--status": (state) => {
		state.status = true;
	},
	"-h": (state) => {
		state.help = true;
	},
};

function applyParsedArgument(
	state: ParsedArgState,
	arg: string,
	next: string | undefined,
	index: number,
): number {
	if (arg === "--") {
		return index;
	}

	if (isIntegrationCommand(arg)) {
		if (state.command !== "issue" || state.issueNumber !== undefined) {
			throw new Error("Only one Sandcastle command may be specified");
		}

		state.command = arg;
		return index;
	}

	const booleanHandler = booleanArgHandlers[arg];
	if (booleanHandler !== undefined) {
		booleanHandler(state);
		return index;
	}

	const valueHandler = valueArgHandlers[arg];
	if (valueHandler !== undefined) {
		return valueHandler(state, next, index);
	}

	if (state.issueNumber === undefined && state.command === "issue" && !arg.startsWith("-")) {
		state.issueNumber = arg;
		return index;
	}

	throw new Error(`Unknown argument: ${arg}`);
}

function finalizeParsedArgs(state: ParsedArgState): CliOptions {
	if (state.issueNumbers.length > 0 && state.integrationNames.length > 0) {
		throw new Error(
			"Do not combine --issues and --integrations; choose one integration operation.",
		);
	}

	if (state.command === "merge" && state.integrationNames.length > 0) {
		throw new Error("The merge command accepts --issues, not --integrations.");
	}

	if (state.command === "merge-integrations" && state.issueNumbers.length > 0) {
		throw new Error("The merge-integrations command accepts --integrations, not --issues.");
	}

	if (
		state.worktree !== undefined &&
		state.worktree !== "" &&
		(state.command === "merge" ||
			state.command === "merge-integrations" ||
			state.command.startsWith("integration-"))
	) {
		throw new Error("--worktree is only supported for issue and issue-sequence workflows.");
	}

	if (
		state.worktree !== undefined &&
		state.worktree !== "" &&
		state.command === "issue" &&
		state.issueNumber === "all"
	) {
		throw new Error("--worktree cannot be used with --issue all.");
	}

	if (!isAgentBackend(state.agentBackend)) {
		throw new Error(`SANDCASTLE_AGENT must be one of: ${config.agents.enabled.join(", ")}`);
	}

	if (!isSandcastleEffort(state.effort)) {
		throw new Error("SANDCASTLE_EFFORT must be one of: low, medium, high, xhigh, max");
	}

	const legacyModelEnvKey =
		state.agentBackend === "dirac" ? "DIRAC_SANDCASTLE_MODEL" : "PI_SANDCASTLE_MODEL";
	const legacyModel = process.env[legacyModelEnvKey]?.trim() ?? "";
	const model =
		state.model?.trim() ??
		config.agents.models[state.agentBackend]?.trim() ??
		(legacyModel !== "" ? legacyModel : undefined);
	if (!state.help && (model === undefined || model === "")) {
		throw new Error(
			`No model configured for ${state.agentBackend}; set agents.models.${state.agentBackend} in sandcastle.config.ts or pass --model <model>.`,
		);
	}

	return {
		agentBackend: state.agentBackend,
		allowUnreviewed: state.allowUnreviewed,
		base: state.base,
		command: state.command,
		concurrency: state.concurrency,
		dryRun: state.dryRun,
		effort: state.effort,
		force: state.force,
		help: state.help,
		ignoreSetup: state.ignoreSetup,
		integrationName: state.integrationName,
		integrationNames: state.integrationNames,
		issueNumber: state.issueNumber ?? "",
		issueNumbers: state.issueNumbers,
		maxImplementIterations: state.maxImplementIterations,
		model: model ?? "",
		phase: state.phase,
		resume: state.resume,
		sequentialIssues: state.sequentialIssues,
		status: state.status,
		worktree: state.worktree,
	};
}

export function parseArgs(argv: ReadonlyArray<string>): CliOptions {
	const state = createParsedArgState();

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === undefined) {
			continue;
		}

		index = applyParsedArgument(state, arg, argv[index + 1], index);
	}

	return finalizeParsedArgs(state);
}

export function printHelp(): void {
	console.log(`Three-phase Sandcastle runner: Design → Implement → Review.

Issue workflow:
  pnpm sandcastle:issue -- --issue <number> [options]
  pnpm sandcastle:issue -- --issue all

Sequential issue workflow:
  pnpm sandcastle:issue -- issue-sequence --sequential 151,150,147 --base sandcastle/issue-100 [options]

  Runs issues sequentially, composing changes from each into the next.
  Previous issue's commits are present when working on the next.
  Automatically aborts if any issue concludes with "blocked" status.

Integration workflow:
  pnpm sandcastle merge --name <name> --issues 123,124 [--base main]
  pnpm sandcastle merge-integrations --name <name> --integrations a,b [--base main]
  pnpm sandcastle integration-status --name <name>
  pnpm sandcastle integration-resume --name <name>
  pnpm sandcastle integration-abort --name <name>
  pnpm sandcastle integration-cleanup --name <name>

Shared options:
      --model <model>        Workflow-wide model; also used for integration review
	      --agent <backend>      dirac | pi (default: dirac)
      --effort <level>       low | medium | high | xhigh | max
      --allow-unreviewed     Explicitly allow sources whose review is incomplete
      --dry-run              Print resolved config without starting an agent
      --force                 Allow cleanup of a dirty integration worktree

Issue options:
  -i, --issue <number>       GitHub issue number (or "all")
      --max-iterations <n>   Max iterations for the implementer (default: 100)
  -c, --concurrency <n>     Max parallel issues for "all" mode (default: 1)
      --resume               Resume from last incomplete phase
      --phase <phase>        Run only one phase (design | implement | review)
      --force [phase]        Force re-run (optionally specify which phase)
      --ignore-setup         Continue even if env/pnpm setup fails
      --status               Print phase evaluation without running
      --worktree <path>      Use an existing registered worktree directly
  -h, --help                 Show this help

Sequential workflow options:
      --sequential <issues>  Comma-separated issue numbers to run sequentially (151,150,147)
      --base <ref>           Base ref/commit/branch to start from (default: main; can be sandcastle/issue-100)
      --worktree <path>      Append in an existing worktree (issue and sequence only)
`);
}

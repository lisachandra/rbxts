/*
 * CLI argument parsing and help text.
 *
 * Precedence for agent/model/effort: explicit flags win, then the repo's
 * sandcastle.config.ts, then the deprecated environment variables (which print
 * a warning in main()).
 */

import { resolve as pathResolve } from "node:path";

import { type HelpTopicKey, renderHelpTopic } from "./help.js";
import { isQueueSubcommand, type QueueSubcommand, queueSubcommands } from "./queue/commands.js";
import { config } from "./runtime.js";
import { agentStepNames, resolveAgentSteps } from "./steps.js";
import type {
	AgentBackend,
	AgentPhaseName,
	AgentStepsConfig,
	PhaseName,
	ResolvedAgentStep,
	SandcastleEffort,
} from "./types.js";

export type CliCommand =
	| "issue"
	| "merge"
	| "setup"
	| "queue"
	| "issue-sequence"
	| "integration-abort"
	| "merge-integrations"
	| "integration-status"
	| "integration-resume"
	| "integration-cleanup";

export interface CliOptions {
	readonly after?: string;
	readonly afterMerge?: string;
	readonly agentBackend: AgentBackend;
	readonly allowUnreviewed: boolean;
	readonly base: string;
	readonly before?: string;
	readonly branch: string;
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
	readonly joins?: string;
	readonly jsonOut: boolean;
	readonly maxIssues?: number;
	readonly mergeName?: string;
	readonly model: string;
	readonly noResume?: boolean;
	readonly notes?: string;
	readonly phase?: PhaseName;
	readonly quarantineDrift?: boolean;
	readonly queueApply?: boolean;
	readonly queueBucket?: "gated" | "human";
	readonly queueClosed?: boolean;
	readonly queueCommit?: boolean;
	readonly queueCommitAny?: boolean;
	readonly queueDelete?: boolean;
	readonly queueEnabled?: boolean;
	readonly queueIncludeHuman?: boolean;
	readonly queueKeepEntries?: boolean;
	readonly queuePromoteGates?: boolean;
	readonly queueRequireClean?: boolean;
	readonly queueSequence?: string;
	readonly queueStrictGates?: boolean;
	readonly queueSubcommand?: QueueSubcommand;
	readonly reason?: string;
	readonly resume: boolean;
	readonly roles?: Record<string, string>;
	readonly sequentialIssues: Array<string>;
	readonly skipSetup?: boolean;
	readonly status: boolean;
	readonly steps: Record<AgentPhaseName, ResolvedAgentStep>;
	readonly title?: string;
	readonly worktree?: string;
}

/**
 * - Parses `--roles 382=shell,383=pause` into an issue-number keyed phrase map.
 * - @param value - Raw flag value; entries are `<issue>=<role>`.
 * - @returns Role phrases keyed by issue number, rendered beside each batch member.
 * - @throws {Error} When an entry is not `<issue>=<role>` or the flag is empty.
 */
export function parseRoles(value: string | undefined): Record<string, string> {
	const roles: Record<string, string> = {};
	for (const entry of commaSeparated(value, "--roles")) {
		const separator = entry.indexOf("=");
		const issue = entry.slice(0, separator);
		const role = entry.slice(separator + 1).trim();
		if (separator === -1 || !/^\d+$/u.test(issue) || role === "") {
			throw new Error(
				`--roles entries look like <issue>=<role>; got ${JSON.stringify(entry)}`,
			);
		}

		roles[issue] = role;
	}

	return roles;
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
	after: string | undefined;
	afterMerge: string | undefined;
	agentBackend: AgentBackend;
	allowUnreviewed: boolean;
	base: string;
	before: string | undefined;
	branch: string | undefined;
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
	joins: string | undefined;
	jsonOut: boolean;
	maxIssues: number | undefined;
	mergeName: string | undefined;
	model: string | undefined;
	noResume: boolean;
	notes: string | undefined;
	phase: PhaseName | undefined;
	quarantineDrift: boolean;
	queueApply: boolean;
	queueBucket: "gated" | "human" | undefined;
	queueClosed: boolean;
	queueCommit: boolean | undefined;
	queueCommitAny: boolean | undefined;
	queueDelete: boolean;
	queueEnabled: boolean | undefined;
	queueIncludeHuman: boolean;
	queueKeepEntries: boolean;
	queuePromoteGates: boolean;
	queueRequireClean: boolean;
	queueSequence: string | undefined;
	queueStrictGates: boolean;
	queueSubcommand: undefined | QueueSubcommand;
	reason: string | undefined;
	resume: boolean;
	roles: undefined | Record<string, string>;
	sequentialIssues: Array<string>;
	skipSetup: boolean;
	status: boolean;
	steps: AgentStepsConfig;
	title: string | undefined;
	worktree: string | undefined;
}

function createParsedArgState(): ParsedArgState {
	return {
		after: undefined,
		afterMerge: undefined,
		agentBackend: config.agents.default,
		allowUnreviewed: false,
		base: config.baseBranch,
		before: undefined,
		branch: undefined,
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
		joins: undefined,
		jsonOut: false,
		maxIssues: undefined,
		mergeName: undefined,
		model: undefined,
		noResume: false,
		notes: undefined,
		phase: undefined,
		quarantineDrift: false,
		queueApply: false,
		queueBucket: undefined,
		queueClosed: false,
		queueCommit: undefined,
		queueCommitAny: undefined,
		queueDelete: false,
		queueEnabled: undefined,
		queueIncludeHuman: false,
		queueKeepEntries: false,
		queuePromoteGates: false,
		queueRequireClean: false,
		queueSequence: undefined,
		queueStrictGates: false,
		queueSubcommand: undefined,
		reason: undefined,
		resume: false,
		roles: undefined,
		sequentialIssues: [],
		skipSetup: false,
		status: false,
		steps: {},
		title: undefined,
		worktree: undefined,
	};
}

function isPhaseName(value: string | undefined): value is PhaseName {
	return value === "design" || value === "implement" || value === "review";
}

function isAgentBackend(value: string | undefined): value is AgentBackend {
	return (
		value === "claude-code" ||
		value === "codex" ||
		value === "copilot" ||
		value === "cursor" ||
		value === "dirac" ||
		value === "opencode" ||
		value === "pi"
	);
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

function isCliCommand(value: string): value is CliCommand {
	return value === "queue" || value === "setup" || isIntegrationCommand(value);
}

type ArgHandler = (state: ParsedArgState, next: string | undefined, index: number) => number;

function setStepModel(
	state: ParsedArgState,
	step: AgentPhaseName,
	flag: string,
	value: string | undefined,
): void {
	if (value === undefined || value.trim() === "" || value.startsWith("-")) {
		throw new Error(`${flag} requires a value`);
	}

	state.steps[step] = { ...state.steps[step], model: value.trim() };
}

function setStepBackend(
	state: ParsedArgState,
	step: AgentPhaseName,
	flag: string,
	value: string | undefined,
): void {
	if (!isAgentBackend(value)) {
		throw new Error(
			`${flag} must be one of: claude-code, codex, copilot, cursor, dirac, opencode, pi`,
		);
	}

	state.steps[step] = { ...state.steps[step], backend: value };
}

function setStepEffort(
	state: ParsedArgState,
	step: AgentPhaseName,
	flag: string,
	value: string | undefined,
): void {
	if (!isSandcastleEffort(value)) {
		throw new Error(`${flag} must be one of: low, medium, high, xhigh, max`);
	}

	state.steps[step] = { ...state.steps[step], effort: value };
}

const valueArgHandlers: Record<string, ArgHandler> = {
	"--after": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--after requires a value");
		}

		state.after = next;
		return index + 1;
	},
	"--after-merge": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--after-merge requires an integration name");
		}

		state.afterMerge = next;
		return index + 1;
	},
	"--agent": (state, next, index) => {
		if (!isAgentBackend(next)) {
			throw new Error(
				"--agent must be one of: claude-code, codex, copilot, cursor, dirac, opencode, pi",
			);
		}

		state.agentBackend = next;
		return index + 1;
	},
	"--base": (state, next, index) => {
		state.base = next ?? state.base;
		return index + 1;
	},
	"--before": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--before requires a batch name");
		}

		state.before = next;
		return index + 1;
	},
	"--branch": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--branch requires a value");
		}

		state.branch = next;
		return index + 1;
	},
	"--concurrency": (state, next, index) => {
		state.concurrency = Math.max(1, Number(next ?? "1"));
		return index + 1;
	},
	"--design-agent": (state, next, index) => {
		setStepBackend(state, "design", "--design-agent", next);
		return index + 1;
	},
	"--design-effort": (state, next, index) => {
		setStepEffort(state, "design", "--design-effort", next);
		return index + 1;
	},
	"--design-model": (state, next, index) => {
		setStepModel(state, "design", "--design-model", next);
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
	"--implement-agent": (state, next, index) => {
		setStepBackend(state, "implement", "--implement-agent", next);
		return index + 1;
	},
	"--implement-effort": (state, next, index) => {
		setStepEffort(state, "implement", "--implement-effort", next);
		return index + 1;
	},
	"--implement-model": (state, next, index) => {
		setStepModel(state, "implement", "--implement-model", next);
		return index + 1;
	},
	"--integration-review-agent": (state, next, index) => {
		setStepBackend(state, "integrationReview", "--integration-review-agent", next);
		return index + 1;
	},
	"--integration-review-effort": (state, next, index) => {
		setStepEffort(state, "integrationReview", "--integration-review-effort", next);
		return index + 1;
	},
	"--integration-review-model": (state, next, index) => {
		setStepModel(state, "integrationReview", "--integration-review-model", next);
		return index + 1;
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
	"--joins": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--joins requires a batch name");
		}

		state.joins = next;
		return index + 1;
	},
	"--max-issues": (state, next, index) => {
		const parsed = Number(next);
		if (next === undefined || next === "" || !Number.isInteger(parsed) || parsed < 1) {
			throw new Error("--max-issues requires a positive integer");
		}

		state.maxIssues = parsed;
		return index + 1;
	},
	"--merge-name": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--merge-name requires a value");
		}

		state.mergeName = next;
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
	"--notes": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--notes requires a value");
		}

		state.notes = next;
		return index + 1;
	},
	"--phase": (state, next, index) => {
		if (!isPhaseName(next)) {
			throw new Error("--phase must be one of: design, implement, review");
		}

		state.phase = next;
		return index + 1;
	},
	"--planner-agent": (state, next, index) => {
		setStepBackend(state, "planner", "--planner-agent", next);
		return index + 1;
	},
	"--planner-effort": (state, next, index) => {
		setStepEffort(state, "planner", "--planner-effort", next);
		return index + 1;
	},
	"--planner-model": (state, next, index) => {
		setStepModel(state, "planner", "--planner-model", next);
		return index + 1;
	},
	"--reason": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--reason requires a value");
		}

		state.reason = next;
		return index + 1;
	},
	"--resolve-agent": (state, next, index) => {
		setStepBackend(state, "resolve", "--resolve-agent", next);
		return index + 1;
	},
	"--resolve-effort": (state, next, index) => {
		setStepEffort(state, "resolve", "--resolve-effort", next);
		return index + 1;
	},
	"--resolve-model": (state, next, index) => {
		setStepModel(state, "resolve", "--resolve-model", next);
		return index + 1;
	},
	"--review-agent": (state, next, index) => {
		setStepBackend(state, "review", "--review-agent", next);
		return index + 1;
	},
	"--review-effort": (state, next, index) => {
		setStepEffort(state, "review", "--review-effort", next);
		return index + 1;
	},
	"--review-model": (state, next, index) => {
		setStepModel(state, "review", "--review-model", next);
		return index + 1;
	},
	"--roles": (state, next, index) => {
		state.roles = parseRoles(next);
		return index + 1;
	},
	"--sequence": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--sequence requires a value");
		}

		state.queueSequence = next;
		return index + 1;
	},
	"--sequential": (state, next, index) => {
		state.sequentialIssues.push(...commaSeparated(next, "--sequential"));
		return index + 1;
	},
	"--title": (state, next, index) => {
		if (next === undefined || next === "" || next.startsWith("-")) {
			throw new Error("--title requires a label");
		}

		state.title = next;
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
	"--apply": (state) => {
		state.queueApply = true;
	},
	"--closed": (state) => {
		state.queueClosed = true;
	},
	"--delete": (state) => {
		state.queueDelete = true;
	},
	"--dry-run": (state) => {
		state.dryRun = true;
	},
	"--gated": (state) => {
		if (state.queueBucket !== undefined) {
			throw new Error("Choose either --gated or --human, not both.");
		}

		state.queueBucket = "gated";
	},
	"--help": (state) => {
		state.help = true;
	},
	"--human": (state) => {
		if (state.queueBucket !== undefined) {
			throw new Error("Choose either --gated or --human, not both.");
		}

		state.queueBucket = "human";
	},
	"--ignore-setup": (state) => {
		state.ignoreSetup = true;
	},
	"--include-human": (state) => {
		state.queueIncludeHuman = true;
	},
	"--json": (state) => {
		state.jsonOut = true;
	},
	"--keep-entries": (state) => {
		state.queueKeepEntries = true;
	},
	"--no-queue": (state) => {
		state.queueEnabled = false;
	},
	"--no-queue-commit": (state) => {
		state.queueCommit = false;
	},
	"--no-resume": (state) => {
		state.noResume = true;
	},
	"--promote-gates": (state) => {
		state.queuePromoteGates = true;
	},
	"--quarantine-drift": (state) => {
		state.quarantineDrift = true;
	},
	"--queue": (state) => {
		state.queueEnabled = true;
	},
	"--queue-commit": (state) => {
		state.queueCommit = true;
	},
	"--queue-commit-any": (state) => {
		state.queueCommitAny = true;
	},
	"--require-clean": (state) => {
		state.queueRequireClean = true;
	},
	"--resume": (state) => {
		state.resume = true;
	},
	"--skip-setup": (state) => {
		state.skipSetup = true;
	},
	"--status": (state) => {
		state.status = true;
	},
	"--strict-gates": (state) => {
		state.queueStrictGates = true;
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

	if (isCliCommand(arg)) {
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

	if (state.command === "queue" && state.queueSubcommand === undefined && !arg.startsWith("-")) {
		if (!isQueueSubcommand(arg)) {
			throw new Error(
				`Unknown queue subcommand: ${arg} (expected one of: ${queueSubcommands.join(", ")})`,
			);
		}

		state.queueSubcommand = arg;
		return index;
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

	if (state.command === "setup" && state.branch !== undefined && state.branch !== "") {
		if (state.worktree !== undefined && state.worktree !== "") {
			throw new Error("--branch cannot be combined with --worktree.");
		}
	} else if (state.branch !== undefined && state.branch !== "") {
		throw new Error("--branch is only supported for the setup command.");
	}

	if (
		state.worktree !== undefined &&
		state.worktree !== "" &&
		(state.command === "merge" ||
			state.command === "merge-integrations" ||
			state.command.startsWith("integration-"))
	) {
		throw new Error(
			"--worktree is only supported for issue, issue-sequence, and setup workflows.",
		);
	}

	if (
		state.worktree !== undefined &&
		state.worktree !== "" &&
		state.command === "issue" &&
		state.issueNumber === "all"
	) {
		throw new Error("--worktree cannot be used with --issue all.");
	}

	/*
	 * `--help` short-circuits every requirement check below: asking what a command needs must never
	 * fail because it was not given. Skipping the block leaves `queueSubcommand` as parsed, which is
	 * exactly what `helpTopicKey` needs.
	 */
	if (state.command === "queue" && !state.help) {
		if (state.queueSubcommand === undefined) {
			throw new Error(`queue requires a subcommand: ${queueSubcommands.join(", ")}`);
		}

		if (state.queueBucket !== undefined && state.queueSequence !== undefined) {
			throw new Error("Choose either --sequence or --gated/--human, not both.");
		}

		if (state.queueSubcommand === "add") {
			if (state.issueNumber === undefined) {
				throw new Error("queue add requires --issue <number>.");
			}

			if (state.queueSequence === undefined && state.queueBucket === undefined) {
				throw new Error(
					"queue add requires a placement: --sequence <name> or --gated/--human.",
				);
			}

			if (state.queueBucket !== undefined && state.reason === undefined) {
				throw new Error("queue add with --gated/--human requires --reason <text>.");
			}

			if (state.after !== undefined && state.queueSequence === undefined) {
				throw new Error("--after requires --sequence <name>.");
			}

			if (state.joins !== undefined && state.queueBucket === undefined) {
				throw new Error("--joins requires --gated or --human.");
			}
		} else if (state.queueSubcommand === "sequence" && state.integrationName === undefined) {
			throw new Error("queue sequence requires --name <batch>.");
		} else if (
			state.queueSubcommand === "sequence" &&
			state.queueDelete !== true &&
			state.issueNumbers.length === 0
		) {
			throw new Error("queue sequence requires --issues <a,b,c> (or --delete to remove it).");
		} else if (
			state.queueSubcommand === "rule" &&
			(state.issueNumbers.length === 0 || state.reason === undefined)
		) {
			throw new Error("queue rule requires --issues <a,b> and --reason <text>.");
		}

		if (
			state.queueSubcommand === "run" &&
			(state.queueBucket !== undefined || state.queueSequence !== undefined)
		) {
			throw new Error(
				"queue run does not accept --gated/--human/--sequence; place issues with `queue add`.",
			);
		}

		if (
			state.queueSubcommand !== "sequence" &&
			(state.title !== undefined ||
				state.roles !== undefined ||
				state.afterMerge !== undefined ||
				state.before !== undefined)
		) {
			throw new Error(
				"--title, --roles, --after-merge, and --before describe a batch; use them with `queue sequence`.",
			);
		}

		if (state.queueDelete === true && state.queueSubcommand !== "sequence") {
			throw new Error("--delete removes a batch; use it with `queue sequence`.");
		}

		if (state.queueSubcommand === "prune" && state.queueClosed !== true) {
			throw new Error(
				"queue prune requires --closed: it only removes references to closed issues.",
			);
		}

		if (state.queueSubcommand === "remove" && state.issueNumber === undefined) {
			throw new Error("queue remove requires --issue <number>.");
		}
	}

	if (!isAgentBackend(state.agentBackend)) {
		throw new Error(`SANDCASTLE_AGENT must be one of: ${config.agents.enabled.join(", ")}`);
	}

	if (!isSandcastleEffort(state.effort)) {
		throw new Error("SANDCASTLE_EFFORT must be one of: low, medium, high, xhigh, max");
	}

	const legacyModelEnvKey =
		state.agentBackend === "dirac"
			? "DIRAC_SANDCASTLE_MODEL"
			: state.agentBackend === "pi"
				? "PI_SANDCASTLE_MODEL"
				: undefined;
	const legacyModel =
		legacyModelEnvKey !== undefined ? (process.env[legacyModelEnvKey]?.trim() ?? "") : "";
	const model =
		state.model?.trim() ??
		config.agents.models[state.agentBackend]?.trim() ??
		(legacyModel !== "" ? legacyModel : undefined);
	const workflowModel = model ?? "";
	const steps = resolveAgentSteps(
		{ agentBackend: state.agentBackend, effort: state.effort, model: workflowModel },
		config.agents.models,
		config.agents.steps,
		state.steps,
	);
	for (const step of agentStepNames) {
		if (!isAgentBackend(steps[step].agentBackend)) {
			throw new Error(`SANDCASTLE_AGENT must be one of: ${config.agents.enabled.join(", ")}`);
		}
	}

	if (!state.help && state.command !== "setup" && state.command !== "queue") {
		for (const step of agentStepNames) {
			if (steps[step].model === "") {
				throw new Error(
					`No model configured for ${steps[step].agentBackend} (step ${step}); set agents.models.${steps[step].agentBackend} or agents.steps.${step}.model in sandcastle.config.ts or pass --model <model> / --${step}-model <model>.`,
				);
			}
		}

		if (model === undefined || model === "") {
			throw new Error(
				`No model configured for ${state.agentBackend}; set agents.models.${state.agentBackend} in sandcastle.config.ts or pass --model <model>.`,
			);
		}
	}

	return {
		after: state.after,
		afterMerge: state.afterMerge,
		agentBackend: state.agentBackend,
		allowUnreviewed: state.allowUnreviewed,
		base: state.base,
		before: state.before,
		branch: state.branch ?? "",
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
		joins: state.joins,
		jsonOut: state.jsonOut,
		maxIssues: state.maxIssues,
		mergeName: state.mergeName,
		model: model ?? "",
		noResume: state.noResume,
		notes: state.notes,
		phase: state.phase,
		quarantineDrift: state.quarantineDrift,
		queueApply: state.queueApply,
		queueBucket: state.queueBucket,
		queueClosed: state.queueClosed,
		queueCommit: state.queueCommit,
		queueCommitAny: state.queueCommitAny,
		queueDelete: state.queueDelete,
		queueEnabled: state.queueEnabled,
		queueIncludeHuman: state.queueIncludeHuman,
		queueKeepEntries: state.queueKeepEntries,
		queuePromoteGates: state.queuePromoteGates,
		queueRequireClean: state.queueRequireClean,
		queueSequence: state.queueSequence,
		queueStrictGates: state.queueStrictGates,
		queueSubcommand: state.queueSubcommand,
		reason: state.reason,
		resume: state.resume,
		roles: state.roles,
		sequentialIssues: state.sequentialIssues,
		skipSetup: state.skipSetup,
		status: state.status,
		steps,
		title: state.title,
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

export function printHelp(topic?: HelpTopicKey): void {
	if (topic !== undefined) {
		console.log(renderHelpTopic(topic));
		return;
	}

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

Setup workflow (harness / manual worktrees):
  sandcastle setup [--worktree <path>]
  sandcastle setup --branch <name> [--base <ref>]

  Prepares a worktree for agent runs: creates .sandcastle state dirs, copies .env,
  runs setupCommands, and links symlinks. No flags prepares the current directory
  (e.g. a clean paseo worktree). Idempotent; safe to re-run.
Queue workflow (batch manifest + live view):
  pnpm sandcastle queue add --issue <n> [--sequence <name> | --gated | --human] [--reason <text>] [--after <n>] [--joins <batch>]
  pnpm sandcastle queue sequence --name <batch> --issues <a,b,c> [--title <label>] [--roles <n=role,...>]
                                 [--merge-name <branch>] [--after-merge <integration>] [--notes <text>]
  pnpm sandcastle queue rule [--name <R#>] --issues <a,b> --reason <text>
  pnpm sandcastle queue remove --issue <n>
  pnpm sandcastle queue prune --closed [--json]
  pnpm sandcastle queue list [--json] [--strict-gates]
  pnpm sandcastle queue check [--json] [--strict-gates]
  pnpm sandcastle queue run [--name <batch>] [--max-issues <n>] [--keep-entries] [--dry-run]
  pnpm sandcastle queue bootstrap [--apply] [--dry-run]

  The queue manifest (default sandcastle.queue.json, git-tracked) stores only what
  GitHub cannot express: sequence composition/run order, serialization rules, gates.
  Issue state is fetched live; queue check reports drift (unplaced ready issues,
  closed-but-listed, referenced-but-missing) and exits 1, or 2 when --strict-gates also
  counts an unresolved gate. queue run fires the next READY sequence and re-reads the
  manifest after every batch, so a review that registered a follow-up changes what runs
  next inside the same invocation; landed entries are pruned unless --keep-entries.
  queue bootstrap proposes placements for the unplaced backlog; --apply writes them.

  Bypass for repositories that do not want the queue workflow: set queue.enabled: false in
  sandcastle.config.ts (or pass --no-queue). Reviews then report follow-ups in the issue
  comment only. --queue re-enables it per invocation, and --queue-commit commits the
  manifest after every mutation (never pushes).
Shared options:
      --model <model>        Workflow-wide model; also used for integration review
	      --agent <backend>      claude-code | codex | copilot | cursor | dirac | opencode | pi (default: dirac)
      --effort <level>       low | medium | high | xhigh | max (max → xhigh)
      --allow-unreviewed     Explicitly allow sources whose review is incomplete
      --dry-run              Print resolved config without starting an agent
      --force                 Allow cleanup of a dirty integration worktree
      --ignore-setup         Continue even if env/pnpm setup fails
      --skip-setup           Skip env/pnpm setup commands (symlinks still linked)
      --quarantine-drift     Stash uncommitted worktree drift instead of failing the merge

Per-step overrides (flag > agents.steps config > workflow default):
      --design-model <m> | --design-agent <b> | --design-effort <l>
      --implement-model <m> | --implement-agent <b> | --implement-effort <l>
      --review-model <m> | --review-agent <b> | --review-effort <l>
      --planner-model <m> | --planner-agent <b> | --planner-effort <l>
      --resolve-model <m> | --resolve-agent <b> | --resolve-effort <l>
      --integration-review-model <m> | --integration-review-agent <b> | --integration-review-effort <l>

Issue options:
  -i, --issue <number>       GitHub issue number (or "all")
  -c, --concurrency <n>     Max parallel issues for "all" mode (default: 1)
      --resume               Resume from last incomplete phase
      --phase <phase>        Run only one phase (design | implement | review)
      --force [phase]        Force re-run (optionally specify which phase)
      --status               Print phase evaluation without running
      --worktree <path>      Use an existing registered worktree directly
  -h, --help                 Show this help

Sequential workflow options:
      --sequential <issues>  Comma-separated issue numbers to run sequentially (151,150,147)
      --base <ref>           Base ref/commit/branch to start from (default: main; can be sandcastle/issue-100)
      --worktree <path>      Append in an existing worktree (issue and sequence only)
`);
}

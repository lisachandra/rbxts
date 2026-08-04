// oxlint-disable typescript/no-non-null-assertion, typescript/no-unnecessary-condition, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-argument -- Sandcastle bridges dynamic agent/tool JSON at a Node runtime boundary.
/*
 * Sandcastle entry point.
 *
 * Parses the CLI, routes to the requested workflow, and re-exports the full
 * runner API for programmatic consumers and tests. The implementation lives in
 * focused sibling modules (cli, issue, sequential, integrations, ...) so each
 * concern stays small and independently testable.
 *
 * Usage:
 *   pnpm sandcastle:issue -- --issue <number>
 *   pnpm sandcastle:issue -- --issue all        # plan + dispatch unblocked issues
 *   pnpm sandcastle:issue -- --issue <number> --dry-run
 *   pnpm sandcastle:issue -- --issue <number> --resume           # resume from last incomplete phase
 *   pnpm sandcastle:issue -- --issue <number> --resume --model X # resume with a different model
 *   pnpm sandcastle:issue -- --issue <number> --phase implement  # run only one phase
 *   pnpm sandcastle:issue -- --issue <number> --force design     # force re-run a phase
 *   pnpm sandcastle:issue -- --issue <number> --status           # print phase evaluation
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseArgs, printHelp } from "./cli.js";
import {
	abortIntegration,
	cleanupIntegration,
	printIntegrationStatus,
	resumeIntegration,
	runNewIntegration,
} from "./integrations.js";
import { runAll, runSingleIssue } from "./issue.js";
import { io, normalizedPath } from "./runtime.js";
import { runSequentialIssues } from "./sequential.js";
import { printStatus } from "./status.js";

export * from "./agent.js";
export * from "./cli.js";
export {
	escapeRegExp,
	loadConfig,
	phaseNames,
	type PromptFileKey,
	promptFileKeys,
	type ResolvedSandcastleConfig,
	type SandcastleConfig,
	sandcastleConfigSchema,
	type SandcastleUserConfig,
} from "./config.js";
export * from "./evaluate.js";
export * from "./git.js";
export * from "./integrations.js";
export * from "./issue.js";
export * from "./retry.js";
export { config, io, normalizedPath, packageRoot, repoRoot } from "./runtime.js";
export * from "./sequential.js";
export * from "./state.js";
export * from "./status.js";
export * from "./types.js";
export * from "./worktree.js";

const mainModulePath = fileURLToPath(import.meta.url);

let deprecationWarningsShown = false;

/**
 * Warns about legacy environment variables that moved into `sandcastle.config.ts`. Only API keys
 * (OPENAI_API_KEY, OPENAI_API_BASE, GH_TOKEN) remain environment-driven.
 */
function warnDeprecatedEnv(): void {
	if (deprecationWarningsShown) {
		return;
	}

	deprecationWarningsShown = true;
	const warnings: Array<string> = [];
	if (process.env.SANDCASTLE_AGENT !== undefined) {
		warnings.push("SANDCASTLE_AGENT is deprecated; set agents.default in sandcastle.config.ts");
	}

	if (process.env.SANDCASTLE_EFFORT !== undefined) {
		warnings.push("SANDCASTLE_EFFORT is deprecated; set effort in sandcastle.config.ts");
	}

	for (const key of ["DIRAC_SANDCASTLE_MODEL", "PI_SANDCASTLE_MODEL"] as const) {
		if (process.env[key] === undefined) {
			continue;
		}

		const backend = key === "DIRAC_SANDCASTLE_MODEL" ? "dirac" : "pi";
		warnings.push(`${key} is deprecated; set agents.models.${backend} in sandcastle.config.ts`);
	}

	if (process.env.SANDCASTLE_MODEL !== undefined) {
		warnings.push(
			"SANDCASTLE_MODEL is not read; set agents.models.<backend> in sandcastle.config.ts",
		);
	}

	for (const warning of warnings) {
		console.warn(`  ⚠ ${warning}`);
	}
}

export async function main(): Promise<void> {
	warnDeprecatedEnv();
	const options = parseArgs(process.argv.slice(2));

	if (options.help) {
		printHelp();
		io.exit(0);
	}

	if (options.dryRun) {
		console.log(
			JSON.stringify(
				{
					agent: options.agentBackend,
					allowUnreviewed: options.allowUnreviewed,
					base: options.base,
					command: options.command,
					concurrency: options.concurrency,
					effort: options.effort,
					force: options.force === true ? "all" : (options.force ?? undefined),
					integrationName: options.integrationName ?? undefined,
					integrations: options.integrationNames,
					issueNumber: options.issueNumber || undefined,
					issues: options.issueNumbers,
					maxImplementIterations: options.maxImplementIterations,
					model: options.model,
					phase: options.phase ?? undefined,
					phases:
						options.command === "issue"
							? ["design", "implement", "review"]
							: ["preflight", "merge", "conflict-resolution", "review"],
					resume: options.resume,
					sandbox: "no-sandbox",
					worktree: options.worktree ?? undefined,
				},
				undefined,
				2,
			),
		);
		io.exit(0);
	}

	if (options.command === "issue") {
		if (!options.issueNumber) {
			printHelp();
			throw new Error("A numeric GitHub issue number (or 'all') is required.");
		}

		if (options.status) {
			printStatus(options.issueNumber, options.model, options.base, options.worktree);
			io.exit(0);
		}

		if (options.issueNumber === "all") {
			await runAll(
				options.model,
				options.agentBackend,
				options.effort,
				options.maxImplementIterations,
				options.concurrency,
				options.ignoreSetup,
			);
		} else {
			await runSingleIssue(
				options.issueNumber,
				options.model,
				options.effort,
				options.maxImplementIterations,
				{
					agentBackend: options.agentBackend,
					baseRef: options.base,
					force: options.force,
					ignoreSetup: options.ignoreSetup,
					phase: options.phase,
					resume: options.resume,
					worktree: options.worktree,
				},
			);
		}

		return;
	}

	if (options.command === "issue-sequence") {
		if (options.sequentialIssues.length === 0) {
			printHelp();
			throw new Error(
				"--sequential is required for issue-sequence command (comma-separated issue numbers)",
			);
		}

		await runSequentialIssues(
			options.sequentialIssues,
			options.base,
			options.model,
			options.effort,
			options.maxImplementIterations,
			options.agentBackend,
			options.resume,
			options.worktree,
			options.ignoreSetup,
		);
		return;
	}

	const name = options.integrationName;
	if (name === undefined || name === "") {
		throw new Error(`--name is required for ${options.command}.`);
	}

	switch (options.command) {
		case "integration-abort": {
			abortIntegration(name);

			break;
		}
		case "integration-cleanup": {
			cleanupIntegration(name, options.force === true);

			break;
		}
		case "integration-resume": {
			await resumeIntegration(name, options.model, options.effort, options.agentBackend);

			break;
		}
		case "integration-status": {
			printIntegrationStatus(name);

			break;
		}
		case "merge": {
			await runNewIntegration(
				"issues",
				name,
				options.issueNumbers,
				options.base,
				options.allowUnreviewed,
				options.model,
				options.effort,
				options.agentBackend,
			);

			break;
		}
		case "merge-integrations": {
			await runNewIntegration(
				"integrations",
				name,
				options.integrationNames,
				options.base,
				options.allowUnreviewed,
				options.model,
				options.effort,
				options.agentBackend,
			);

			break;
		}
		// No default
	}
}

function isDirectRun(): boolean {
	const entry = process.argv[1];
	if (entry === undefined || entry === "") {
		return false;
	}

	try {
		return normalizedPath(realpathSync(entry)) === normalizedPath(realpathSync(mainModulePath));
	} catch {
		return false;
	}
}

if (isDirectRun()) {
	main()
		.then(() => io.exit(0))
		.catch((err: unknown) => {
			console.error(err);
			io.exit(1);
		});
}

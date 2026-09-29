/*
 * `queue land`: compose a batch's integration, then hand its PR to a human.
 *
 * Composition was always automatic — the conflict resolver and the integration review run as agents
 * (`integration/orchestrator.ts`). What was manual was the seam around it: remembering the tail
 * issue to pass to `merge`, then writing the PR by hand. This module owns that seam.
 *
 * The human merge is the boundary this command does not cross. `--create-pr` pushes the integration
 * branch and opens the PR; nothing here runs `gh pr merge`. The PR body carries one `Closes #<n>`
 * line per member, so merging it closes the batch's issues natively — which is also what clears
 * their `blocked-by` edges for the next batch.
 *
 * `--finish` is the other half of the lifecycle: member issues come back CLOSED, the batch is
 * removed, and every `after` gate pointing at it is cleared in the same transaction.
 */

import type { CliOptions } from "../cli.js";
import { integrationBranch, readIntegrationManifest } from "../integration/manifest.js";
import { resumeIntegration, runNewIntegration } from "../integration/orchestrator.js";
import { config, io, repoRoot } from "../runtime.js";
import type { IntegrationManifest } from "../types.js";
import { fetchLiveQueueState } from "./live.js";
import { type QueueManifest, readQueueManifest } from "./manifest.js";
import { clearAfterReferences, deleteSequence, removeIssue } from "./mutations.js";
import { emitText } from "./output.js";
import { transactQueueManifest } from "./persist.js";

/** Integration statuses where the branch is composed and the only work left is the human merge. */
const landedStatuses: ReadonlySet<IntegrationManifest["status"]> = new Set<
	IntegrationManifest["status"]
>(["integrated", "ready-for-human-merge", "review-passed"]);

export interface LandTarget {
	/** Members in run order; the PR closes every one of them on merge. */
	issues: Array<string>;
	/** Batch name, which is the integration name. */
	name: string;
	/** One entry per `notes` line, quoted in the PR body. */
	notes: Array<string>;
	/** Per-issue role phrase, keyed by issue number. */
	roles: undefined | Record<string, string>;
	/** Tail issue: the member whose branch carries every earlier member's commits. */
	tail: string;
	title: string | undefined;
}

function noteLines(notes: string | undefined): Array<string> {
	return (notes ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/**
 * - Resolves the batch a `land` invocation is composing.
 * - @param manifest - The queue manifest.
 * - @param name - Batch name, which is an integration name.
 * - @returns The tail issue, members, roles, notes, and title the PR is built from.
 * - @throws {Error} When no batch carries that name, or it has no members to compose.
 */
export function resolveLandTarget(manifest: QueueManifest, name: string): LandTarget {
	const sequence = manifest.sequences.find((entry) => entry.name === name);
	if (sequence === undefined) {
		const known = manifest.sequences.map((entry) => entry.name).join(", ") || "none";
		throw new Error(`No batch named "${name}" in the queue manifest. Batches: ${known}.`);
	}

	const tail = sequence.issues.at(-1);
	if (tail === undefined) {
		throw new Error(
			`Batch "${name}" has no members to compose; delete it or add issues to it first.`,
		);
	}

	return {
		issues: [...sequence.issues],
		name,
		notes: noteLines(sequence.notes),
		roles: sequence.roles,
		tail,
		title: sequence.title,
	};
}

/** `ui-wiring-work: ui wiring`, or the bare name when the batch carries no title. */
export function landPrTitle(target: LandTarget): string {
	return target.title === undefined ? target.name : `${target.name}: ${target.title}`;
}

/**
 * - The PR body: what the batch is, then one `Closes` line per member.
 * - @param target - Output of {@link resolveLandTarget}.
 * - @returns Markdown body for `gh pr create`.
 * - @remarks `Closes #<n>` per member is the contract that makes merging the PR close the batch's
 *   issues, which in turn clears their `blocked-by` edges for the next batch.
 * - @example
 *
 *   ```markdown
 *   Batch `ui-wiring-work` — ui wiring
 *
 *   Members in run order: #382 shell + ScreenHost, #383 pause + options onto shell
 *
 *   Merging this PR lands the batch on the base branch. Every member closes with it:
 *
 *   Closes #382
 *   Closes #383
 *   ```
 */
export function landPrBody(target: LandTarget): string {
	const members = target.issues
		.map((issue) => {
			const role = target.roles?.[issue];
			return role === undefined ? `#${issue}` : `#${issue} ${role}`;
		})
		.join(", ");
	const titleSuffix = target.title === undefined ? "" : ` — ${target.title}`;
	const lines = [
		`Batch \`${target.name}\`${titleSuffix}`,
		"",
		`Members in run order: ${members}`,
	];
	for (const note of target.notes) {
		lines.push("", `> ${note}`);
	}

	lines.push(
		"",
		"Merging this PR lands the batch on the base branch. Every member closes with it:",
		"",
	);
	for (const issue of target.issues) {
		lines.push(`Closes #${issue}`);
	}

	lines.push("", "---", "", `Composed by \`sandcastle queue land --name ${target.name}\`.`);
	return lines.join("\n");
}

export interface LandCommand {
	args: Array<string>;
	file: string;
	/** Shell-ready rendering for the printed (default) path. */
	line: string;
}

/** Commands that publish the PR; `--create-pr` runs them, the default prints them. */
export function landPrCommands(target: LandTarget, base: string): Array<LandCommand> {
	const branch = integrationBranch(target.name);
	const title = landPrTitle(target);
	const push = ["push", "-u", "origin", branch];
	const create = [
		"pr",
		"create",
		"--base",
		base,
		"--head",
		branch,
		"--title",
		title,
		"--body",
		landPrBody(target),
	];
	return [
		{ args: push, file: "git", line: `git ${push.join(" ")}` },
		{
			args: create,
			file: "gh",
			line: [
				`gh pr create --base ${base} --head ${branch} \\`,
				`  --title ${JSON.stringify(title)} \\`,
				"  --body \"$(cat <<'EOF'",
				landPrBody(target),
				"EOF",
				')"',
			].join("\n"),
		},
	];
}

/** Injectable seams: agent composition, the integration manifest, and the shell. */
export interface LandDeps {
	compose?: (options: CliOptions, target: LandTarget) => Promise<void>;
	integration?: (name: string) => undefined | IntegrationManifest;
	run?: (file: string, args: Array<string>) => string;
}

function defaultRun(file: string, args: Array<string>): string {
	return io
		.execFileSync(file, args, {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		})
		.toString()
		.trim();
}

/**
 * - Composes (or resumes) a batch's integration with the conflict resolver and integration review.
 * - @param options - Parsed CLI options: model, effort, agent backend, steps, base, setup flags.
 * - @param target - The batch being landed.
 * - @rejects {Error} When a source is unapproved, the worktree is missing, or composition fails.
 * - @remarks Idempotent by status: a composition already at `integrated`/`review-passed`/
 *   `ready-for-human-merge` is left alone, so re-running `land` after the agents finished goes
 *   straight to the PR.
 */
export async function composeLandTarget(options: CliOptions, target: LandTarget): Promise<void> {
	const existing = readIntegrationManifest(target.name);
	if (existing !== undefined && landedStatuses.has(existing.status)) {
		emitText(
			options,
			`  ✓ Integration "${target.name}" is already composed (${existing.status})`,
		);
		return;
	}

	if (existing === undefined) {
		emitText(options, `  ▶ Composing "${target.name}" from #${target.tail}`);
		await runNewIntegration(
			"issues",
			target.name,
			[target.tail],
			options.base,
			options.allowUnreviewed,
			options.model,
			options.effort,
			options.agentBackend,
			options.ignoreSetup,
			options.skipSetup,
			options.steps,
			options.quarantineDrift,
		);
		return;
	}

	emitText(options, `  ↻ Resuming integration "${target.name}" (${existing.status})`);
	await resumeIntegration(
		target.name,
		options.model,
		options.effort,
		options.agentBackend,
		options.ignoreSetup,
		options.skipSetup,
		options.steps,
		options.quarantineDrift,
	);
}

/** Why the composition cannot be handed to a human yet; `undefined` when it can. */
function compositionBlocker(
	manifest: undefined | IntegrationManifest,
	name: string,
): string | undefined {
	if (manifest === undefined) {
		return `integration "${name}" has no manifest`;
	}

	if (!landedStatuses.has(manifest.status)) {
		const error = manifest.lastError === undefined ? "" : ` — ${manifest.lastError}`;
		return `integration "${name}" is ${manifest.status}${error}`;
	}

	if (manifest.headCommit === undefined || manifest.headCommit === "") {
		return `integration "${name}" recorded no head commit`;
	}

	return undefined;
}

/** An already-open PR for the branch, if there is one: re-running `land` must not open a second. */
function existingPullRequest(run: LandDeps["run"], branch: string): string | undefined {
	try {
		const url = run?.("gh", ["pr", "view", branch, "--json", "url", "--jq", ".url"]) ?? "";
		return url === "" || url === "null" ? undefined : url;
	} catch {
		// No PR, no remote, or no `gh`: all mean "nothing to report yet".
		return undefined;
	}
}

/** Prints the next human action: the commands that open the PR, or the URL that already exists. */
function reportPullRequest(options: CliOptions, target: LandTarget, run: LandDeps["run"]): void {
	const branch = integrationBranch(target.name);
	const open = existingPullRequest(run, branch);
	if (open !== undefined) {
		emitText(options, `  ✓ Pull request already open for "${target.name}": ${open}`);
		return;
	}

	if (options.createPr !== true) {
		emitText(
			options,
			[
				"",
				"  Compose ready. Open the pull request yourself — sandcastle never merges:",
				...landPrCommands(target, options.base).map((command) =>
					command.line
						.split("\n")
						.map((line) => `    ${line}`)
						.join("\n"),
				),
				"",
				"  Or re-run this with --create-pr to push and open it, and let the merge stay yours.",
			].join("\n"),
		);
		return;
	}

	const url = existingPullRequest(run, branch);
	const urlSuffix = url === undefined ? "" : `: ${url}`;
	for (const command of landPrCommands(target, options.base)) {
		run?.(command.file, command.args);
	}

	emitText(options, `  ✓ Opened the pull request for "${target.name}"${urlSuffix}`);
}

/**
 * - Removes a landed batch and clears every gate waiting on it.
 * - @param options - Parsed CLI options; `--dry-run` reports without writing.
 * - @param target - The batch whose members have closed on GitHub.
 * - @param run - Shell seam, unused here but kept so a caller passes one dependency set.
 * - @remarks Faithful to the lifecycle: GitHub closed the members through the PR's `Closes` lines, so
 *   this is the step that takes them out of the manifest and removes the now-meaningless `after`
 *   references. While members are still open nothing is written — a batch is not landed until it
 *   is.
 */
export function finishLand(options: CliOptions, target: LandTarget, run: LandDeps["run"]): void {
	void run;
	const live = fetchLiveQueueState({
		numbers: new Set(target.issues),
		readyLabel: config.labels.readyForAgent,
	});
	const open = target.issues.filter((issue) => live.issues.get(issue)?.state !== "CLOSED");
	const openList = open.map((issue) => `#${issue}`).join(", ");
	if (open.length > 0) {
		emitText(options, `  ⏳ "${target.name}" is not landed yet; still open: ${openList}`);
		return;
	}

	const landed = target.issues.filter((issue) => live.issues.get(issue)?.found === true);
	transactQueueManifest(options, (manifest) => {
		let next: QueueManifest = manifest;
		for (const issue of landed) {
			try {
				next = removeIssue(next, issue);
			} catch {
				// Already absent; nothing to remove.
			}
		}

		if (next.sequences.some((sequence) => sequence.name === target.name)) {
			next = deleteSequence(next, target.name);
		}

		const cleared = next.sequences.filter((sequence) => sequence.after === target.name).length;
		next = clearAfterReferences(next, target.name);
		return {
			message: `  ✓ Landed "${target.name}": removed ${landed.length} member(s), cleared ${cleared} after gate(s)`,
			next,
			summary: `land "${target.name}"`,
		};
	});
}

/**
 * - Runs `queue land`: compose, then print (or open) the batch's pull request.
 * - @param options - Parsed CLI options; `--name` selects the batch.
 * - @param deps - Composition, integration-manifest, and shell seams for tests.
 * - @remarks Nothing in this path merges to the base branch. Landing is the human's act; the next
 *   `queue run` sees the batch's `after` gate open once the merge commit is an ancestor of base.
 *
 * @rejects {Error} When `--name` is missing, the batch is unknown or empty, or composition fails.
 */
export async function runQueueLand(options: CliOptions, deps: LandDeps = {}): Promise<void> {
	const name = options.integrationName;
	if (name === undefined || name === "") {
		throw new Error(
			"queue land requires --name <batch-name>; see `queue list` for batch names.",
		);
	}

	const target = resolveLandTarget(readQueueManifest(), name);
	const run = deps.run ?? defaultRun;
	if (options.landFinish === true) {
		finishLand(options, target, run);
		return;
	}

	if (options.dryRun) {
		emitText(options, `  (dry run) would compose "${target.name}" from #${target.tail}`);
		for (const command of landPrCommands(target, options.base)) {
			emitText(options, command.line);
		}

		return;
	}

	const compose = deps.compose ?? composeLandTarget;
	await compose(options, target);

	const integration = (deps.integration ?? readIntegrationManifest)(target.name);
	const blocker = compositionBlocker(integration, target.name);
	if (blocker !== undefined) {
		throw new Error(
			`Cannot hand "${target.name}" to a human yet: ${blocker}. Resume it with \`pnpm sandcastle integration-resume --name ${target.name}\`.`,
		);
	}

	reportPullRequest(options, target, run);
}

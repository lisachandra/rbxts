/*
 * Queue mutations: the CLI wrappers, one manifest transaction each.
 *
 * A transaction owns the whole read → mutate → write cycle under the manifest lock, so two writers —
 * a review agent registering a follow-up inside a worktree and a human running `queue add` in
 * another terminal — cannot lose each other's changes. Message text is produced *inside* the
 * transaction because only it sees the manifest that was actually read: "Moved (was sequence "U2"
 * (position 2))" is placement history, and placement history is what makes a queue auditable.
 */

import type { CliOptions } from "../cli.js";
import { config } from "../runtime.js";
import { batchNameForScope, promotableGates, scopeOf } from "./bootstrap.js";
import { fetchLiveQueueState, type LiveIssue, type LiveQueueState } from "./live.js";
import { acquireQueueLock, manifestLockName } from "./lock.js";
import {
	describePlacement,
	locateIssue,
	type QueueManifest,
	queueManifestPath,
	queueManifestVersion,
	readQueueManifest,
	referencedIssues,
	writeQueueManifest,
} from "./manifest.js";
import {
	migrateQueueManifest,
	parseMigrationAssigns,
	readRawQueueManifest,
	renderQueueMigration,
} from "./migrate.js";
import {
	addRule,
	addToSequence,
	clearAfterReferences,
	defineSequence,
	deleteSequence,
	placeIssue,
	promoteIssue,
	removeIssue,
} from "./mutations.js";
import { emitText } from "./output.js";
import {
	commitQueueManifest,
	notifyQueueLocation,
	queueCommitEnabled,
	transactQueueManifest,
} from "./persist.js";

function requireIssueNumber(options: CliOptions, subcommand: string): string {
	if (options.issueNumber === undefined || options.issueNumber === "") {
		throw new Error(`queue ${subcommand} requires --issue <number>`);
	}

	return options.issueNumber;
}

/** Places an issue into a batch, a gate, or the human bucket, reporting the move. */
export function runQueueAdd(options: CliOptions): void {
	const issue = requireIssueNumber(options, "add");
	transactQueueManifest(options, (manifest) => {
		const previous = locateIssue(manifest, issue);
		const next =
			options.queueSequence === undefined
				? placeIssue(manifest, {
						issue,
						joins: options.joins,
						reason: options.reason ?? "",
						target: options.queueBucket === "gated" ? "gated" : "human",
					})
				: addToSequence(manifest, {
						after: options.after,
						issue,
						sequence: options.queueSequence,
					});
		const where = describePlacement(locateIssue(next, issue) ?? { kind: "human" });
		const moved =
			previous === undefined ? "Placed" : `Moved (was ${describePlacement(previous)})`;
		return {
			message: `  ✓ ${moved} #${issue} → ${where}`,
			next,
			summary: `place #${issue} in the queue`,
		};
	});
}

/** Creates, replaces, or deletes a batch definition. */
export function runQueueSequence(options: CliOptions): void {
	const name = options.integrationName ?? "";
	if (name === "") {
		throw new Error("queue sequence requires --name <batch-name>");
	}

	if (options.queueDelete === true) {
		transactQueueManifest(options, (manifest) => ({
			message: `  ✓ Deleted sequence "${name}"`,
			next: deleteSequence(manifest, name),
			summary: `delete sequence "${name}"`,
		}));
		return;
	}

	if (options.issueNumbers.length === 0) {
		throw new Error("queue sequence requires --issues <a,b,c> (or --delete to remove it)");
	}

	const memberCount = options.issueNumbers.length;
	transactQueueManifest(options, (manifest) => ({
		message: `  ✓ Defined sequence "${name}" (${memberCount} issue(s)): ${options.issueNumbers.join(", ")}`,
		next: defineSequence(manifest, {
			after: options.after,
			before: options.before,
			issues: options.issueNumbers,
			last: options.last,
			name,
			notes: options.notes,
			roles: options.roles,
			title: options.title,
		}),
		summary: `define sequence "${name}"`,
	}));
}

/** Adds or replaces a same-file serialization rule. */
export function runQueueRule(options: CliOptions): void {
	if (options.issueNumbers.length === 0) {
		throw new Error("queue rule requires --issues <a,b>");
	}

	if (options.reason === undefined || options.reason === "") {
		throw new Error("queue rule requires --reason");
	}

	const family = options.issueNumbers.join(", ");
	transactQueueManifest(options, (manifest) => ({
		message: `  ✓ Serialization rule for (${family}): ${options.reason ?? ""}`,
		next: addRule(manifest, {
			issues: options.issueNumbers,
			name: options.integrationName,
			reason: options.reason ?? "",
		}),
		summary: `add serialization rule for ${family}`,
	}));
}

/** Removes an issue from every placement. */
export function runQueueRemove(options: CliOptions): void {
	const issue = requireIssueNumber(options, "remove");
	transactQueueManifest(options, (manifest) => ({
		message: `  ✓ Removed #${issue} from the queue manifest`,
		next: removeIssue(manifest, issue),
		summary: `remove #${issue} from the queue`,
	}));
}

/** Removes an issue when it is placed, leaving the manifest untouched when it is not. */
function removeIfPlaced(manifest: QueueManifest, issue: string): QueueManifest {
	try {
		return removeIssue(manifest, issue);
	} catch {
		return manifest;
	}
}

/** Referenced CLOSED issues, excluding `human` entries — a finished decision session is a record. */
function closedIssues(manifest: QueueManifest, live: LiveQueueState): Array<string> {
	const human = new Set(manifest.human.map((entry) => entry.issue));
	return [...referencedIssues(manifest)].filter(
		(issue) => !human.has(issue) && live.issues.get(issue)?.state === "CLOSED",
	);
}

/**
 * - Drops references to CLOSED issues, which otherwise gate their batch forever.
 * - @param options - Parsed CLI options; `--closed` is required, `--dry-run` reports only.
 * - @remarks `human` entries are kept — a finished decision session is still a record — and
 *   referenced-but-missing issues are left as drift for a human to investigate. Live state is
 *   fetched before the lock so the critical section stays short; the closed set is recomputed from
 *   the manifest the transaction reads.
 */
export function runQueuePrune(options: CliOptions): void {
	const live = fetchLiveQueueState({
		numbers: referencedIssues(readQueueManifest()),
		readyLabel: config.labels.readyForAgent,
	});

	transactQueueManifest(options, (manifest) => {
		const closed = closedIssues(manifest, live);
		if (closed.length === 0) {
			return {
				message: "  ✓ Nothing to prune: no closed issues are referenced.",
				next: manifest,
				summary: "prune closed issues",
			};
		}

		let next = manifest;
		for (const issue of closed) {
			next = removeIfPlaced(next, issue);
		}

		/*
		 * Drop sequences this prune emptied: an empty batch is drift (`queue check` fails on it) and
		 * nothing else would ever remove it.
		 */
		const emptied = next.sequences
			.filter((entry) => entry.issues.length === 0)
			.map((entry) => entry.name);
		for (const entry of emptied) {
			// A pruned producer cannot satisfy anything, so its consumers stop waiting on it.
			next = clearAfterReferences(next, entry);
			next = deleteSequence(next, entry);
		}

		const dropped = emptied.length === 0 ? "" : ` and ${emptied.length} now-empty sequence(s)`;
		return {
			message: `  ⌫ Pruned ${closed.length} closed issue(s)${dropped}: ${closed.join(", ")}`,
			next,
			summary: `prune ${closed.length} closed issue(s)`,
		};
	});
}

/** Why a gated issue cannot be promoted yet, in the words of the view that would show it. */
function describeGate(state: LiveIssue | undefined): string {
	if (state === undefined || !state.found) {
		return "not found on GitHub";
	}

	if (state.state === "CLOSED") {
		return "closed";
	}

	if (!state.ready) {
		return "missing ready-for-agent";
	}

	if (state.openBlockers.length > 0) {
		const blockers = state.openBlockers.map((blocker) => `#${blocker}`).join(", ");
		return `blocked by open ${blockers}`;
	}

	return "promotable";
}

/**
 * - Promotes gated issues whose conditions have resolved into their scope sequences.
 * - @param options - `--issue <n>` promotes one gate; `--apply` promotes every promotable gate.
 * - @throws {Error} When the named issue is not gated, or its condition is still open.
 * - @remarks Promotion is the CLI exit from a gate: without it the only way out was to remove the
 *   issue and re-add it into a sequence, which threw away the gate's recorded reason.
 */
export function runQueuePromote(options: CliOptions): void {
	const live = fetchLiveQueueState({
		numbers: referencedIssues(readQueueManifest()),
		readyLabel: config.labels.readyForAgent,
	});

	if (options.queueApply === true) {
		transactQueueManifest(options, (manifest) => {
			const promotions = promotableGates({ live, manifest });
			if (promotions.length === 0) {
				return {
					message: "  ✓ Nothing to promote: no gate is promotable.",
					next: manifest,
					summary: "promote gates",
				};
			}

			let next = manifest;
			for (const promotion of promotions) {
				next = promoteIssue(next, promotion);
			}

			const described = promotions
				.map((promotion) => `#${promotion.issue} → ${promotion.sequence}`)
				.join(", ");
			return {
				message: `  ✓ Promoted ${promotions.length} gate(s): ${described}`,
				next,
				summary: `promote ${promotions.length} gate(s)`,
			};
		});
		return;
	}

	const issue = requireIssueNumber(options, "promote");
	transactQueueManifest(options, (manifest) => {
		const entry = manifest.gated.find((candidate) => candidate.issue === issue);
		if (entry === undefined) {
			throw new Error(`Issue #${issue} is not gated; nothing to promote.`);
		}

		const state = live.issues.get(issue);
		const reason = describeGate(state);
		if (reason !== "promotable") {
			throw new Error(
				`Issue #${issue} is not promotable yet (${reason}); resolve the condition or re-gate it with \`pnpm sandcastle queue add --issue ${issue} --gated --reason "..."\`.`,
			);
		}

		const sequence =
			options.queueSequence ?? entry.joins ?? batchNameForScope(scopeOf(state?.title ?? ""));
		return {
			message: `  ✓ Promoted #${issue} → sequence "${sequence}" (was gated: ${entry.reason})`,
			next: promoteIssue(manifest, { issue, sequence }),
			summary: `promote #${issue}`,
		};
	});
}

/**
 * - Translates a v1 queue manifest into v2, or reports what the translation would do.
 * - @param options - Parsed CLI options; `--assign <old>=<new>` names batches v1 left unnamed, and
 *   `--apply` writes the result (default: print and exit).
 * - @throws {Error} When the manifest is unreadable or a batch has no name to migrate to.
 * - @remarks The one command that reads a v1 file: `readQueueManifest` refuses it by name, so this
 *   takes the manifest lock directly rather than going through `transactQueueManifest`.
 */
export function runQueueMigrate(options: CliOptions): void {
	const path = queueManifestPath();
	const raw = readRawQueueManifest(path);
	if (raw === undefined) {
		emitText(options, `  ⏭ No queue manifest at ${path}; nothing to migrate.`);
		return;
	}

	if ((raw as { version?: unknown }).version === queueManifestVersion) {
		emitText(options, `  ✓ Queue manifest is already version ${String(queueManifestVersion)}.`);
		return;
	}

	const report = migrateQueueManifest(raw, parseMigrationAssigns(options.queueAssigns));
	for (const line of renderQueueMigration(report)) {
		emitText(options, line);
	}

	if (report.unmapped.length > 0) {
		throw new Error(
			`${report.unmapped.length} batch(es) have no integration name; pass --assign <old>=<integration-name> for each and re-run.`,
		);
	}

	if (options.queueApply !== true) {
		emitText(options, "  (proposal only — pass --apply to write it)");
		return;
	}

	if (options.dryRun) {
		emitText(options, "  (dry run — manifest not written)");
		return;
	}

	const release = acquireQueueLock({ name: manifestLockName });
	try {
		writeQueueManifest(report.manifest, path);
	} finally {
		release();
	}

	emitText(options, `  ✓ Migrated ${path} to version ${String(queueManifestVersion)}.`);
	notifyQueueLocation(options);
	if (queueCommitEnabled(options)) {
		commitQueueManifest(
			`migrate the queue manifest to v${String(queueManifestVersion)}`,
			options,
		);
	}
}

/*
 * Sandcastle queue manifest: the git-tracked batch/routing state.
 *
 * GitHub issues remain the canonical store for issue state (open/closed,
 * `ready-for-agent`, blocked-by edges) — those are always fetched live. The
 * manifest records only what GitHub cannot express: batch composition and
 * run order, same-file serialization rules, and gate conditions.
 *
 * A batch has exactly one name: `sequences[].name` is an integration name, and it is the branch
 * (`sandcastle/integration/<name>`), the `--name` argument every queue command takes, and the target
 * an `after` gate references. The short codes the manifest used to carry beside a separate
 * `mergeName` were two namespaces for one thing, and the prose that kept them in sync ("SX joins the
 * S merge") was unreadable by the scheduler.
 *
 * The default file lives at the primary checkout's root (`sandcastle.queue.json`) so
 * it is versioned with the repo and shared by every worktree; override it with
 * `queue.file` in `sandcastle.config.ts`.
 *
 * It resolves against the *primary* checkout rather than the process working
 * directory: a review agent running inside `.sandcastle/worktrees/<branch>` must
 * update the queue where it lives, not a branch-local copy that dies with the
 * worktree.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { z } from "zod";

import { primaryRepoRoot } from "../git.js";
import { integrationNamePattern } from "../integration/manifest.js";
import { config, normalizedPath, repoRoot } from "../runtime.js";

/** Manifest schema version; v1 manifests must be migrated with `sandcastle queue migrate`. */
export const queueManifestVersion = 2;

const issueNumberSchema = z.string().regex(/^\d+$/u, "must be a numeric GitHub issue number");

export const queueSequenceSchema = z.object({
	/**
	 * Integration that must land on the base branch before this batch may fire, e.g.
	 * "vfx-surface-work".
	 *
	 * Run-order gates used to live in `notes` prose that the scheduler never read; every batch
	 * branches from the base branch, so a batch consuming an earlier batch's commits is unsafe
	 * until that batch's integration is an ancestor of it.
	 */
	after: z.string().min(1).optional(),
	/** Issues in run order; position satisfies intra-sequence dependencies. */
	issues: z.array(issueNumberSchema),
	/** Integration name: the branch (`sandcastle/integration/<name>`) and the batch's identity. */
	name: z
		.string()
		.min(1)
		.regex(integrationNamePattern, "must be an integration name: letters, numbers, ., _, or -"),
	/** Free-form notes; each newline starts a new line in the `queue list` rendering. */
	notes: z.string().optional(),
	/** Per-issue role phrase, keyed by issue number, rendered beside each member. */
	roles: z.record(issueNumberSchema, z.string().min(1)).optional(),
	/** Short human label rendered beside the batch name, e.g. "ui wiring". */
	title: z.string().min(1).optional(),
});

export const queueSerializedRuleSchema = z.object({
	issues: z.array(issueNumberSchema).min(1),
	/** Human-readable rule name, e.g. "R4". */
	name: z.string().min(1).optional(),
	reason: z.string().min(1),
});

export const queueEntrySchema = z.object({
	issue: issueNumberSchema,
	/** Batch the issue joins once its gate clears; `queue promote` prefers it over the title scope. */
	joins: z.string().min(1).optional(),
	reason: z.string().min(1),
});

export const queueManifestSchema = z.object({
	gated: z.array(queueEntrySchema),
	human: z.array(queueEntrySchema),
	sequences: z.array(queueSequenceSchema),
	serialized: z.array(queueSerializedRuleSchema),
	updatedAt: z.string().min(1),
	version: z.literal(queueManifestVersion),
});

export type QueueSequence = z.output<typeof queueSequenceSchema>;
export type QueueSerializedRule = z.output<typeof queueSerializedRuleSchema>;
export type QueueEntry = z.output<typeof queueEntrySchema>;
export type QueueManifest = z.output<typeof queueManifestSchema>;

/** Default, relative to the repository root; git-tracked, unlike `.sandcastle/`. */
export const defaultQueueFile = "sandcastle.queue.json";

/** Absolute path of the queue manifest, resolved against the primary checkout. */
export function queueManifestPath(): string {
	return pathResolve(primaryRepoRoot(), config.queue.file);
}

/** Whether the process runs in the primary checkout rather than a linked worktree. */
export function inPrimaryWorktree(): boolean {
	return normalizedPath(repoRoot) === normalizedPath(primaryRepoRoot());
}

export function emptyQueueManifest(): QueueManifest {
	return {
		gated: [],
		human: [],
		sequences: [],
		serialized: [],
		updatedAt: "",
		version: queueManifestVersion,
	};
}

/** Batch names claimed more than once; a batch name is an integration, so it must be unique. */
export function duplicateSequenceNames(sequences: ReadonlyArray<{ name: string }>): Array<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const sequence of sequences) {
		if (seen.has(sequence.name)) {
			duplicates.add(sequence.name);
		}

		seen.add(sequence.name);
	}

	return [...duplicates];
}

function firstIssueMessage(error: z.ZodError): string {
	const issue = error.issues[0];
	if (issue === undefined) {
		return "unknown schema error";
	}

	return `${issue.path.join(".") || "(root)"}: ${issue.message}`;
}

/** Names a batch waits on that no batch produces; the drift `queue check` reports. */
export function unknownGateTargets(
	manifest: QueueManifest,
): Array<{ name: string; target: string }> {
	const produced = new Set(manifest.sequences.map((sequence) => sequence.name));
	const unknown: Array<{ name: string; target: string }> = [];
	for (const sequence of manifest.sequences) {
		const target = sequence.after;
		if (target !== undefined && target !== "" && !produced.has(target)) {
			unknown.push({ name: sequence.name, target });
		}
	}

	return unknown;
}

/**
 * Reads the queue manifest, returning an empty manifest when the file does not exist yet.
 *
 * @remarks
 *   A v1 manifest fails with the migration command rather than a schema message: the rename
 *   (`mergeName` -> `name`, `afterMerge` -> `after`) has exactly one supported translation.
 * @param path - Explicit manifest path; defaults to the configured `queue.file`.
 * @throws {Error} When the file exists but is v1, fails schema validation, or repeats a batch name.
 */
export function readQueueManifest(path: string = queueManifestPath()): QueueManifest {
	if (!existsSync(path)) {
		return emptyQueueManifest();
	}

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	} catch (err) {
		throw new Error(`Queue manifest at ${path} is not valid JSON: ${String(err)}`);
	}

	const version =
		raw !== null && typeof raw === "object" && "version" in raw
			? (raw as { version: unknown }).version
			: undefined;
	if (version === 1) {
		throw new Error(
			`Queue manifest at ${path} is version 1; run \`pnpm sandcastle queue migrate --apply\` to move it to version ${String(queueManifestVersion)}.`,
		);
	}

	const parsed = queueManifestSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`Queue manifest at ${path} is invalid: ${firstIssueMessage(parsed.error)}`);
	}

	const duplicates = duplicateSequenceNames(parsed.data.sequences);
	if (duplicates.length > 0) {
		throw new Error(
			`Queue manifest at ${path} repeats batch name(s): ${duplicates.join(", ")}. A batch name is an integration; fold the duplicates into one batch.`,
		);
	}

	return parsed.data;
}

/** Writes the manifest, stamping `updatedAt` with the current time. */
export function writeQueueManifest(
	manifest: QueueManifest,
	path: string = queueManifestPath(),
): void {
	const stamped: QueueManifest = { ...manifest, updatedAt: new Date().toISOString() };
	mkdirSync(dirname(path), { recursive: true });
	/*
	 * Write-then-rename: a concurrent `queue list` must never read a half-written manifest, and a
	 * crash between the two calls leaves the previous manifest intact instead of a truncated one.
	 */
	const temporary = `${path}.tmp-${String(process.pid)}`;
	writeFileSync(temporary, `${JSON.stringify(stamped, null, "\t")}\n`, "utf-8");
	renameSync(temporary, path);
}

/** Every issue number referenced anywhere in the manifest. */
export function referencedIssues(manifest: QueueManifest): ReadonlySet<string> {
	const numbers = new Set<string>();
	for (const sequence of manifest.sequences) {
		for (const issue of sequence.issues) {
			numbers.add(issue);
		}
	}

	for (const rule of manifest.serialized) {
		for (const issue of rule.issues) {
			numbers.add(issue);
		}
	}

	for (const entry of [...manifest.gated, ...manifest.human]) {
		numbers.add(entry.issue);
	}

	return numbers;
}

export type QueuePlacement =
	| { kind: "gated" }
	| { kind: "human" }
	| { index: number; kind: "sequence"; name: string };

/** Locates an issue's placement in the manifest, or `undefined` when unplaced. */
export function locateIssue(manifest: QueueManifest, issue: string): undefined | QueuePlacement {
	for (const sequence of manifest.sequences) {
		const index = sequence.issues.indexOf(issue);
		if (index !== -1) {
			return { index, kind: "sequence", name: sequence.name };
		}
	}

	if (manifest.gated.some((entry) => entry.issue === issue)) {
		return { kind: "gated" };
	}

	if (manifest.human.some((entry) => entry.issue === issue)) {
		return { kind: "human" };
	}

	return undefined;
}

/** Human-readable placement description used in CLI messages. */
export function describePlacement(placement: QueuePlacement): string {
	switch (placement.kind) {
		case "gated": {
			return "gated";
		}
		case "human": {
			return "human";
		}
		case "sequence": {
			return `batch "${placement.name}" (position ${placement.index + 1})`;
		}
	}
}

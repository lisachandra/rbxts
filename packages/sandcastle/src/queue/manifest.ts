/*
 * Sandcastle queue manifest: the git-tracked batch/routing state.
 *
 * GitHub issues remain the canonical store for issue state (open/closed,
 * `ready-for-agent`, blocked-by edges) — those are always fetched live. The
 * manifest records only what GitHub cannot express: sequence composition and
 * run order, same-file serialization rules, and gate conditions.
 *
 * The default file lives at the repository root (`sandcastle.queue.json`) so it
 * is versioned with the repo; override it with `queue.file` in
 * `sandcastle.config.ts`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { z } from "zod";

import { config, repoRoot } from "../runtime.js";

const issueNumberSchema = z.string().regex(/^\d+$/u, "must be a numeric GitHub issue number");

export const queueSequenceSchema = z.object({
	/** Issues in run order; position satisfies intra-sequence dependencies. */
	issues: z.array(issueNumberSchema),
	/** Integration branch name used by `sandcastle merge --issues <tail>`. */
	mergeName: z.string().min(1).optional(),
	/** Batch name, e.g. "U2". */
	name: z.string().min(1),
	/** Free-form notes (e.g. gating context or ordering rationale). */
	notes: z.string().optional(),
});

export const queueSerializedRuleSchema = z.object({
	issues: z.array(issueNumberSchema).min(1),
	/** Human-readable rule name, e.g. "R4". */
	name: z.string().min(1).optional(),
	reason: z.string().min(1),
});

export const queueEntrySchema = z.object({
	issue: issueNumberSchema,
	reason: z.string().min(1),
});

export const queueManifestSchema = z.object({
	gated: z.array(queueEntrySchema),
	human: z.array(queueEntrySchema),
	sequences: z.array(queueSequenceSchema),
	serialized: z.array(queueSerializedRuleSchema),
	updatedAt: z.string().min(1),
	version: z.literal(1),
});

export type QueueSequence = z.output<typeof queueSequenceSchema>;
export type QueueSerializedRule = z.output<typeof queueSerializedRuleSchema>;
export type QueueEntry = z.output<typeof queueEntrySchema>;
export type QueueManifest = z.output<typeof queueManifestSchema>;

/** Default, relative to the repository root; git-tracked, unlike `.sandcastle/`. */
export const defaultQueueFile = "sandcastle.queue.json";

/** Absolute path of the queue manifest for the current repository/config. */
export function queueManifestPath(): string {
	return pathResolve(repoRoot, config.queue.file);
}

export function emptyQueueManifest(): QueueManifest {
	return {
		gated: [],
		human: [],
		sequences: [],
		serialized: [],
		updatedAt: "",
		version: 1,
	};
}

function firstIssueMessage(error: z.ZodError): string {
	const issue = error.issues[0];
	if (issue === undefined) {
		return "unknown schema error";
	}

	return `${issue.path.join(".") || "(root)"}: ${issue.message}`;
}

/**
 * Reads the queue manifest, returning an empty manifest when the file does not exist yet.
 *
 * @param path - Explicit manifest path; defaults to the configured `queue.file`.
 * @throws {Error} When the file exists but fails schema validation.
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

	const parsed = queueManifestSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`Queue manifest at ${path} is invalid: ${firstIssueMessage(parsed.error)}`);
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
	writeFileSync(path, `${JSON.stringify(stamped, null, "\t")}\n`, "utf-8");
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
			return `sequence "${placement.name}" (position ${placement.index + 1})`;
		}
	}
}

/*
 * Queue manifest translation: v1 -> v2, as data.
 *
 * Lives apart from the command that writes it because two callers share it: `readQueueManifest`
 * translates a v1 file on read, and `queue migrate` writes the v2 form. The dependency is one-way in
 * the sense that matters — `manifest.ts` imports this module for the translation, and this module
 * imports only the schema and types from `manifest.ts`, never its readers. So the translation holds
 * no repository state of its own and cannot recurse back into a manifest read.
 *
 * Exactly one implementation is deliberate: a worktree built before the migration still reads the
 * shared queue file with its older code, and a second translation is a second thing that can disagree.
 */

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

import { integrationNamePattern } from "../integration/manifest.js";
import {
	type QueueManifest,
	queueManifestPath,
	queueManifestSchema,
	queueManifestVersion,
} from "./manifest.js";

/** Assignments supplied as `--assign <old>=<new>,...`. */
export type QueueMigrationAssigns = Readonly<Record<string, string>>;

export interface QueueMigrationReport {
	/** Batches folded into another because they shared an integration name. */
	folds: Array<{ droppedNotes: string; from: string; into: string; issues: Array<string> }>;
	/** `afterMerge` values that named a v1 short code and were rewritten. */
	gates: Array<{ batch: string; from: string; to: string }>;
	/** `--assign` entries that named no v1 batch. */
	ignoredAssigns: Array<string>;
	/** `joins` values that named a v1 short code and were rewritten. */
	joins: Array<{ from: string; issue: string; to: string }>;
	/** The migrated manifest; never written unless every batch is named. */
	manifest: QueueManifest;
	/** `name` -> `name` pairs, in v1 run order. */
	renames: Array<{ from: string; to: string }>;
	/** Batch names with no v1 `mergeName` and no `--assign`; migration refuses to write. */
	unmapped: Array<string>;
}

const rawSequenceSchema = z.object({
	afterMerge: z.string().min(1).optional(),
	issues: z.array(z.string()),
	mergeName: z.string().min(1).optional(),
	name: z.string().min(1),
	notes: z.string().optional(),
	roles: z.record(z.string(), z.string()).optional(),
	title: z.string().min(1).optional(),
});

const rawManifestSchema = z.object({
	gated: z
		.array(
			z.object({
				issue: z.string().min(1),
				joins: z.string().min(1).optional(),
				reason: z.string().min(1),
			}),
		)
		.default([]),
	human: z
		.array(
			z.object({
				issue: z.string().min(1),
				joins: z.string().optional(),
				reason: z.string().min(1),
			}),
		)
		.default([]),
	sequences: z.array(rawSequenceSchema),
	serialized: z
		.array(
			z.object({
				issues: z.array(z.string()).min(1),
				name: z.string().min(1).optional(),
				reason: z.string().min(1),
			}),
		)
		.default([]),
	version: z.number().optional(),
});

type RawManifest = z.output<typeof rawManifestSchema>;

/**
 * - Reads a queue manifest as raw JSON, without the version gate.
 * - @param path - Manifest path; defaults to the configured `queue.file`.
 * - @returns The parsed object, or `undefined` when the file does not exist.
 * - @throws {Error} When the file exists but is not JSON.
 * - @remarks `queue migrate` is the one reader that must see a v1 file, so it cannot go through
 *   {@link readQueueManifest}.
 */
export function readRawQueueManifest(path: string = queueManifestPath()): unknown {
	if (!existsSync(path)) {
		return undefined;
	}

	try {
		return JSON.parse(readFileSync(path, "utf-8")) as unknown;
	} catch (err) {
		throw new Error(`Queue manifest at ${path} is not valid JSON: ${String(err)}`);
	}
}

/**
 * - Parses `--assign <old>=<new>,...` into a lookup.
 * - @param value - Raw flag value.
 * - @returns Old batch name to integration name.
 * - @throws {Error} When an entry is not `<old>=<new>` or the target is not a valid integration name.
 */
export function parseMigrationAssigns(value: string | undefined): QueueMigrationAssigns {
	if (value === undefined || value.trim() === "") {
		return {};
	}

	const assigns: Record<string, string> = {};
	for (const entry of value.split(",")) {
		const trimmed = entry.trim();
		if (trimmed === "") {
			continue;
		}

		const separator = trimmed.indexOf("=");
		const from = trimmed.slice(0, separator).trim();
		const to = trimmed.slice(separator + 1).trim();
		if (separator === -1 || from === "" || !integrationNamePattern.test(to)) {
			throw new Error(
				`--assign entries look like <old>=<integration-name>; got ${JSON.stringify(trimmed)}`,
			);
		}

		assigns[from] = to;
	}

	return assigns;
}

/** The integration name a v1 batch migrates to, or `undefined` when it must be assigned. */
function targetName(
	sequence: RawManifest["sequences"][number],
	assigns: QueueMigrationAssigns,
): string | undefined {
	const assigned = assigns[sequence.name];
	if (assigned !== undefined) {
		return assigned;
	}

	const merged = sequence.mergeName;
	return merged === undefined || merged === "" ? undefined : merged;
}

function remap(value: string | undefined, names: ReadonlyMap<string, string>): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	return names.get(value) ?? value;
}

/**
 * - Translates a v1 manifest into v2, reporting everything it changed.
 * - @param raw - Parsed v1 manifest.
 * - @param assigns - Integration names for batches whose v1 entry had no `mergeName`.
 * - @returns The v2 manifest plus the report `queue migrate` prints.
 * - @throws {Error} When `raw` is not a readable v1 manifest.
 * - @remarks Folding is by name: two v1 batches that migrated to one integration name become one
 *   batch whose members are the first batch's members followed by the folded batch's, so position
 *   still satisfies every intra-batch dependency. A folded batch's `notes` are dropped — that prose
 *   is the coordination v2's unique-name rule replaces — and reported so the loss is visible.
 */
export function migrateQueueManifest(
	raw: unknown,
	assigns: QueueMigrationAssigns = {},
): QueueMigrationReport {
	const parsed = rawManifestSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`Queue manifest is not a readable v1 manifest: ${parsed.error.message}`);
	}

	const source = parsed.data;
	const names = new Map<string, string>();
	const renames: Array<{ from: string; to: string }> = [];
	const unmapped: Array<string> = [];
	for (const sequence of source.sequences) {
		const to = targetName(sequence, assigns);
		if (to === undefined) {
			unmapped.push(sequence.name);
			continue;
		}

		names.set(sequence.name, to);
		renames.push({ from: sequence.name, to });
	}

	const usedAssigns = new Set(renames.map((rename) => rename.from));
	const ignoredAssigns = Object.keys(assigns).filter((from) => !usedAssigns.has(from));
	const gates: QueueMigrationReport["gates"] = [];
	const folds: QueueMigrationReport["folds"] = [];

	/** Batches in migration order; folding rewrites the entry created by the first occurrence. */
	const byName = new Map<string, NonNullable<QueueManifest["sequences"][number]>>();
	const order: Array<string> = [];
	for (const sequence of source.sequences) {
		const name = names.get(sequence.name);
		if (name === undefined) {
			continue;
		}

		const existing = byName.get(name);
		if (existing === undefined) {
			const after = sequence.afterMerge;
			const remappedAfter = remap(after, names);
			if (after !== undefined && remappedAfter !== after) {
				gates.push({ batch: name, from: after, to: remappedAfter ?? after });
			}

			byName.set(name, {
				issues: [...sequence.issues],
				name,
				...(remappedAfter === undefined ? {} : { after: remappedAfter }),
				...(sequence.notes === undefined ? {} : { notes: sequence.notes }),
				...(sequence.roles === undefined ? {} : { roles: { ...sequence.roles } }),
				...(sequence.title === undefined ? {} : { title: sequence.title }),
			});
			order.push(name);
			continue;
		}

		/* A second v1 batch claiming the same integration is a fold, not a duplicate. */
		const added = sequence.issues.filter((issue) => !existing.issues.includes(issue));
		existing.issues = [...existing.issues, ...added];
		/*
		 * The existing batch's roles win on a shared issue. Merging an absent record would leave an
		 * empty `roles: {}` behind, which the schema accepts and which then sits in the committed
		 * manifest as if someone had cleared it deliberately.
		 */
		const mergedRoles = { ...sequence.roles, ...existing.roles };
		if (Object.keys(mergedRoles).length > 0) {
			existing.roles = mergedRoles;
		}

		folds.push({
			droppedNotes: sequence.notes ?? "",
			from: sequence.name,
			into: name,
			issues: [...sequence.issues],
		});
	}

	const manifest: QueueManifest = {
		gated: source.gated.map((entry) => ({
			issue: entry.issue,
			...(entry.joins === undefined
				? {}
				: { joins: remap(entry.joins, names) ?? entry.joins }),
			reason: entry.reason,
		})),
		human: source.human.map((entry) => ({ issue: entry.issue, reason: entry.reason })),
		sequences: order.map((name) => byName.get(name)).filter((entry) => entry !== undefined),
		serialized: source.serialized,
		updatedAt: new Date().toISOString(),
		version: queueManifestVersion,
	};

	const joins: QueueMigrationReport["joins"] = [];
	for (const [index, entry] of source.gated.entries()) {
		const original = entry.joins;
		const migrated = manifest.gated[index]?.joins;
		if (original !== undefined && migrated !== undefined && original !== migrated) {
			joins.push({ from: original, issue: entry.issue, to: migrated });
		}
	}

	const validated = queueManifestSchema.safeParse(manifest);
	if (!validated.success) {
		throw new Error(`Migrated manifest is not valid: ${validated.error.message}`);
	}

	return {
		folds,
		gates,
		ignoredAssigns,
		joins,
		manifest: validated.data,
		renames,
		unmapped,
	};
}

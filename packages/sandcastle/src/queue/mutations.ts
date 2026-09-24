/*
 * Pure queue-manifest mutations.
 *
 * Each function returns a new manifest and throws on invalid placement, so the
 * CLI layer can render messages and stamp `updatedAt` at write time while the
 * logic stays testable without a filesystem.
 *
 * Move semantics:
 * - `placeIssue` (gated/human) always moves the issue from wherever it currently is —
 *   promoting a gated issue into a batch or demoting one back is a normal flow.
 * - `addToSequence` moves automatically out of gated/human, but throws when the issue
 *   already sits in a different sequence: silently rewriting another batch's
 *   composition is how queues go stale. Use `removeIssue` first for a deliberate move.
 * - `defineSequence` redefines its own sequence freely; it throws when it would
 *   steal an issue from a different sequence.
 */

import { describePlacement, locateIssue, type QueueManifest } from "./manifest.js";

export interface PlaceIssueParams {
	issue: string;
	reason: string;
	target: "gated" | "human";
}

/** Inserts or updates an issue into the gated or human bucket, removing any other placement. */
export function placeIssue(manifest: QueueManifest, params: PlaceIssueParams): QueueManifest {
	const sequences: QueueManifest["sequences"] = [];
	for (const sequence of manifest.sequences) {
		const issues = sequence.issues.filter((member) => member !== params.issue);
		sequences.push(
			issues.length === sequence.issues.length ? sequence : { ...sequence, issues },
		);
	}

	const stripped: QueueManifest = {
		...manifest,
		gated: manifest.gated.filter((entry) => entry.issue !== params.issue),
		human: manifest.human.filter((entry) => entry.issue !== params.issue),
		sequences,
	};

	const entry = { issue: params.issue, reason: params.reason };
	return params.target === "gated"
		? { ...stripped, gated: [...stripped.gated, entry] }
		: { ...stripped, human: [...stripped.human, entry] };
}

export interface AddToSequenceParams {
	/** Insert after this issue number instead of appending. */
	after?: string;
	issue: string;
	sequence: string;
}

/** Appends (or inserts) an issue into a sequence, lifting it out of gated/human. */
export function addToSequence(manifest: QueueManifest, params: AddToSequenceParams): QueueManifest {
	const sequence = manifest.sequences.find((entry) => entry.name === params.sequence);
	if (sequence === undefined) {
		throw new Error(
			`Sequence "${params.sequence}" is not defined; create it with: sandcastle queue sequence --name ${params.sequence} --issues <a,b,c>`,
		);
	}

	const previous = locateIssue(manifest, params.issue);
	if (previous?.kind === "sequence" && previous.name !== params.sequence) {
		throw new Error(
			`Issue #${params.issue} already belongs to ${describePlacement(previous)}; run \`sandcastle queue remove --issue ${params.issue}\` before moving it to "${params.sequence}".`,
		);
	}

	if (params.after !== undefined && !sequence.issues.includes(params.after)) {
		throw new Error(
			`--after ${params.after} is not a member of sequence "${params.sequence}".`,
		);
	}

	const stripped: QueueManifest = {
		...manifest,
		gated: manifest.gated.filter((entry) => entry.issue !== params.issue),
		human: manifest.human.filter((entry) => entry.issue !== params.issue),
	};

	const sequences = stripped.sequences.map((entry) => {
		if (entry.name !== params.sequence) {
			return entry;
		}

		const withoutIssue = entry.issues.filter((member) => member !== params.issue);
		const insertAt =
			params.after === undefined
				? withoutIssue.length
				: withoutIssue.indexOf(params.after) + 1;
		const issues = [
			...withoutIssue.slice(0, insertAt),
			params.issue,
			...withoutIssue.slice(insertAt),
		];
		return { ...entry, issues };
	});

	const next: QueueManifest = { ...stripped, sequences };
	return next;
}

export interface DefineSequenceParams {
	issues: ReadonlyArray<string>;
	mergeName?: string;
	name: string;
	notes?: string;
}

/** Creates or replaces a sequence definition. */
export function defineSequence(
	manifest: QueueManifest,
	params: DefineSequenceParams,
): QueueManifest {
	const duplicates = params.issues.filter(
		(issue, index) => params.issues.indexOf(issue) !== index,
	);
	if (duplicates.length > 0) {
		throw new Error(`--issues contains duplicates: ${duplicates.join(", ")}`);
	}

	for (const issue of params.issues) {
		const placement = locateIssue(manifest, issue);
		if (placement?.kind === "sequence" && placement.name !== params.name) {
			throw new Error(
				`Issue #${issue} already belongs to ${describePlacement(placement)}; remove it there before defining "${params.name}".`,
			);
		}
	}

	const claimed = new Set(params.issues);
	const sequences: QueueManifest["sequences"] = [];
	for (const entry of manifest.sequences) {
		if (entry.name === params.name) {
			continue;
		}

		const issues = entry.issues.filter((member) => !claimed.has(member));
		sequences.push(issues.length === entry.issues.length ? entry : { ...entry, issues });
	}

	sequences.push({
		issues: [...params.issues],
		...(params.mergeName !== undefined ? { mergeName: params.mergeName } : {}),
		...(params.notes !== undefined ? { notes: params.notes } : {}),
		name: params.name,
	});

	const gated = manifest.gated.filter((entry) => !claimed.has(entry.issue));
	const human = manifest.human.filter((entry) => !claimed.has(entry.issue));

	return { ...manifest, gated, human, sequences };
}

export interface AddRuleParams {
	issues: ReadonlyArray<string>;
	name?: string;
	reason: string;
}

/** Appends a serialization rule, updating an existing rule with the same issue set. */
export function addRule(manifest: QueueManifest, params: AddRuleParams): QueueManifest {
	const duplicates = params.issues.filter(
		(issue, index) => params.issues.indexOf(issue) !== index,
	);
	if (duplicates.length > 0) {
		throw new Error(`--issues contains duplicates: ${duplicates.join(", ")}`);
	}

	const keyOf = (issues: ReadonlyArray<string>): string => [...issues].sort().join(",");
	const key = keyOf(params.issues);
	const existing = manifest.serialized.find((rule) => keyOf(rule.issues) === key);
	if (existing === undefined) {
		const rule: QueueManifest["serialized"][number] = {
			issues: [...params.issues],
			reason: params.reason,
			...(params.name !== undefined ? { name: params.name } : {}),
		};
		return { ...manifest, serialized: [...manifest.serialized, rule] };
	}

	const serialized: QueueManifest["serialized"] = [];
	for (const rule of manifest.serialized) {
		if (keyOf(rule.issues) !== key) {
			serialized.push(rule);
			continue;
		}

		serialized.push({
			issues: [...params.issues],
			reason: params.reason,
			...(params.name !== undefined ? { name: params.name } : {}),
		});
	}

	return { ...manifest, serialized };
}

/** Removes an issue from every placement (sequences, gated, human). */
export function removeIssue(manifest: QueueManifest, issue: string): QueueManifest {
	const previous = locateIssue(manifest, issue);
	if (previous === undefined) {
		throw new Error(`Issue #${issue} is not placed in the queue manifest.`);
	}

	const sequences: QueueManifest["sequences"] = [];
	for (const sequence of manifest.sequences) {
		const issues = sequence.issues.filter((member) => member !== issue);
		sequences.push(
			issues.length === sequence.issues.length ? sequence : { ...sequence, issues },
		);
	}

	const next: QueueManifest = {
		...manifest,
		gated: manifest.gated.filter((entry) => entry.issue !== issue),
		human: manifest.human.filter((entry) => entry.issue !== issue),
		sequences,
	};

	return next;
}

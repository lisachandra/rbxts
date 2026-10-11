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

import {
	describePlacement,
	locateIssue,
	type QueueEntry,
	type QueueManifest,
	type QueueSequence,
} from "./manifest.js";

export interface PlaceIssueParams {
	issue: string;
	/**
	 * Batch this issue joins when its gate clears; the previous entry's target is kept when
	 * omitted.
	 */
	joins?: string;
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

	/*
	 * `joins` survives a re-gate: refining an entry's reason must not silently drop the batch it is
	 * waiting for, which is what forced promotion to guess the target from the issue title.
	 */
	const previous = [...manifest.gated, ...manifest.human].find(
		(candidate) => candidate.issue === params.issue,
	);
	const joins = params.joins ?? previous?.joins;
	const entry: QueueEntry = {
		issue: params.issue,
		...(joins === undefined ? {} : { joins }),
		reason: params.reason,
	};
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
		const anchorIndex =
			params.after === undefined ? undefined : withoutIssue.indexOf(params.after);
		/*
		 * `--after` was validated against the sequence before the issue was filtered out, so a
		 * missing anchor here is always self-reference. Without this guard `indexOf` returns -1,
		 * `insertAt` becomes 0, and the issue silently jumps to the head of the batch.
		 */
		if (params.after !== undefined && anchorIndex === -1) {
			throw new Error(
				`--after ${params.after} is the issue being moved; an issue cannot be inserted after itself.`,
			);
		}

		const insertAt = anchorIndex === undefined ? withoutIssue.length : anchorIndex + 1;
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

export interface MidChainInsertionParams {
	/** Returns true when the member has already been dispatched (its state file exists). */
	isDispatched: (issue: string) => boolean;
	/** The issue that was just inserted. */
	issue: string;
	/** The manifest _after_ the insertion, so the new position is visible. */
	manifest: QueueManifest;
}

/**
 * - Names the first already-dispatched member that now sits after the inserted issue.
 * - @returns The refusal message, or undefined when the insertion chains nothing that ran.
 * - @remarks Position is a dependency statement: each member's branch becomes the next member's base,
 *   so inserting ahead of a dispatched member leaves that branch behind the insertion and `queue
 *   land` refuses the moved tail. Pure — the caller decides what "dispatched" means, which keeps
 *   mutations filesystem-free while the enforcement still happens on every registration.
 */
export function midChainInsertionConflict(params: MidChainInsertionParams): string | undefined {
	const sequence = params.manifest.sequences.find((entry) => entry.issues.includes(params.issue));
	if (sequence === undefined) {
		return undefined;
	}

	const at = sequence.issues.indexOf(params.issue);
	for (const member of sequence.issues.slice(at + 1)) {
		if (!params.isDispatched(member)) {
			continue;
		}

		return (
			`#${member} of batch "${sequence.name}" has already been dispatched; inserting #${params.issue} ` +
			"ahead of it leaves that member's branch behind the insertion and `queue land` will refuse " +
			"the moved tail. Append to the batch tail instead (omit --after) or register it gated: " +
			`\`sandcastle queue add --issue ${params.issue} --gated --reason "..."\`.`
		);
	}

	return undefined;
}

export interface DefineSequenceParams {
	/** Integration that must land on the base branch before this batch may fire. */
	after?: string;
	/** Batch to place this one before; omitted keeps its previous position, or the tail when new. */
	before?: string;
	issues: ReadonlyArray<string>;
	/** Move the batch to the end of the run order. */
	last?: boolean;
	name: string;
	notes?: string;
	/** Per-issue role phrase, keyed by issue number; every key must be a member. */
	roles?: Record<string, string>;
	/** Short human label, e.g. "ui wiring". */
	title?: string;
}

/** Drops `undefined` values so a written manifest never carries empty keys. */
function defined(sequence: Partial<QueueSequence>): QueueSequence {
	const entries = Object.entries(sequence).filter(
		([, value]: [string, unknown]) => value !== undefined,
	);
	return Object.fromEntries(entries) as QueueSequence;
}

/**
 * - Places a batch in the run order.
 * - @param kept - The other batches, in their existing order.
 * - @param batch - The definition being inserted.
 * - @param params - The definition request; `before` and `last` name an explicit position.
 * - @param previousIndex - Where the batch sat before, or `-1` when it is new.
 * - @returns The run order with the batch in place.
 * - @throws {Error} When `--before` names the batch itself or an undefined batch.
 * - @remarks Run order is the array order, so a redefinition keeps its slot: without this every
 *   `queue sequence` call silently moved the batch to the tail and re-ranked the schedule.
 */
function placeBatch(
	kept: QueueManifest["sequences"],
	batch: QueueSequence,
	params: DefineSequenceParams,
	previousIndex: number,
): QueueManifest["sequences"] {
	if (params.last === true) {
		return [...kept, batch];
	}

	if (params.before !== undefined) {
		if (params.before === params.name) {
			throw new Error(`--before ${params.before} is the batch being defined.`);
		}

		const at = kept.findIndex((entry) => entry.name === params.before);
		if (at === -1) {
			throw new Error(`--before ${params.before} is not a defined batch.`);
		}

		return [...kept.slice(0, at), batch, ...kept.slice(at)];
	}

	if (previousIndex === -1) {
		return [...kept, batch];
	}

	return [...kept.slice(0, previousIndex), batch, ...kept.slice(previousIndex)];
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

	for (const issue of Object.keys(params.roles ?? {})) {
		if (!params.issues.includes(issue)) {
			throw new Error(
				`--roles names #${issue}, which is not a member of sequence "${params.name}".`,
			);
		}
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
	const kept: QueueManifest["sequences"] = [];
	for (const entry of manifest.sequences) {
		if (entry.name === params.name) {
			continue;
		}

		const issues = entry.issues.filter((member) => !claimed.has(member));
		kept.push(issues.length === entry.issues.length ? entry : { ...entry, issues });
	}

	/*
	 * Label metadata persists across a redefinition: `after`, `notes`, `roles`, and `title`
	 * describe a batch, and dropping them because a later `queue sequence --issues` call omitted the
	 * flag is how the readable half of the manifest decayed into bare issue numbers.
	 */
	const previousIndex = manifest.sequences.findIndex((entry) => entry.name === params.name);
	const previous = previousIndex === -1 ? undefined : manifest.sequences[previousIndex];
	const redefined = defined({
		after: params.after ?? previous?.after,
		issues: [...params.issues],
		name: params.name,
		notes: params.notes ?? previous?.notes,
		roles: params.roles ?? previous?.roles,
		title: params.title ?? previous?.title,
	});

	/*
	 * Run order is array order, so a redefinition keeps its position: replacing a batch's membership
	 * or its labels must not silently move it behind every other batch. Only a new batch joins the
	 * tail, and `--before` moves a batch explicitly.
	 */
	const sequences = placeBatch(kept, redefined, params, previousIndex);

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

export interface DeleteRuleParams {
	/** Retire only the rule whose sorted issue set matches exactly. */
	issues?: ReadonlyArray<string>;
	/** Retire every rule carrying this name; a name may cover several issue sets. */
	name?: string;
}

/**
 * - Rules matching a delete request: every rule with `name`, and/or the rule whose sorted issue set
 *   equals `issues`.
 * - @remarks Exported so the CLI message can print exactly what a retire removed before removing it;
 *   {@link deleteRule} shares this matcher so the message and the mutation cannot disagree.
 */
export function matchingRules(
	manifest: QueueManifest,
	params: DeleteRuleParams,
): QueueManifest["serialized"] {
	const keyOf = (issues: ReadonlyArray<string>): string => [...issues].sort().join(",");
	const key = params.issues === undefined ? undefined : keyOf(params.issues);
	return manifest.serialized.filter(
		(rule) =>
			(params.name === undefined || rule.name === params.name) &&
			(key === undefined || keyOf(rule.issues) === key),
	);
}

/**
 * - Retires serialization rules by name, by exact issue set, or by both.
 * - @throws {Error} When nothing matches, so a retire never silently no-ops.
 * - @remarks The sorted issue set stays the add key — a name is not one, which is how one name came
 *   to cover two disjoint sets — so narrowing a rule is retire-then-redeclare, not an upsert.
 */
export function deleteRule(manifest: QueueManifest, params: DeleteRuleParams): QueueManifest {
	if (params.name === undefined && params.issues === undefined) {
		throw new Error("Retiring a rule requires --name <R#> or --issues <a,b>.");
	}

	if (params.issues !== undefined) {
		const { issues } = params;
		const duplicates = issues.filter((issue, index) => issues.indexOf(issue) !== index);
		if (duplicates.length > 0) {
			throw new Error(`--issues contains duplicates: ${duplicates.join(", ")}`);
		}
	}

	const matches = matchingRules(manifest, params);
	if (matches.length === 0) {
		const described = [
			params.name !== undefined ? `name "${params.name}"` : undefined,
			params.issues !== undefined ? `issues (${params.issues.join(", ")})` : undefined,
		]
			.filter((part) => part !== undefined)
			.join(" and ");
		throw new Error(`No serialization rule matches ${described}.`);
	}

	const retired = new Set(matches);
	return {
		...manifest,
		serialized: manifest.serialized.filter((rule) => !retired.has(rule)),
	};
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

/**
 * - Clears every `after` gate that waits on a batch.
 * - @param manifest - The queue manifest.
 * - @param name - Batch (integration) name that landed or was deleted.
 * - @returns A manifest whose consumers wait on nothing.
 * - @remarks This is the mechanical half of the landed lifecycle: once a batch's PR has merged, the
 *   gate it represented is satisfied forever, so a wait pointing at it is stale bookkeeping rather
 *   than information. `queue run --land --finish` and `queue prune --closed` call it; a deliberate
 *   `queue sequence --delete` does not, because that path must ask.
 */
export function clearAfterReferences(manifest: QueueManifest, name: string): QueueManifest {
	let changed = false;
	const sequences = manifest.sequences.map((sequence) => {
		if (sequence.after !== name) {
			return sequence;
		}

		changed = true;
		const { after: _dropped, ...rest } = sequence;
		return rest;
	});

	return changed ? { ...manifest, sequences } : manifest;
}

/** Batches whose `after` gate waits on `name`; a definition that still has consumers. */
export function afterConsumers(manifest: QueueManifest, name: string): Array<string> {
	return manifest.sequences
		.filter((sequence) => sequence.after === name)
		.map((sequence) => sequence.name);
}

/**
 * Removes a sequence definition; the members keep whatever placement remains.
 *
 * @throws {Error} When another batch waits on it (`after`) - deleting a producer is a deliberate
 *   act, so the caller must clear or delete its consumers first; `clearAfterReferences` is the
 *   exit.
 */
export function deleteSequence(manifest: QueueManifest, name: string): QueueManifest {
	if (!manifest.sequences.some((entry) => entry.name === name)) {
		throw new Error(`Sequence "${name}" is not defined.`);
	}

	const consumers = afterConsumers(manifest, name);
	if (consumers.length > 0) {
		const waiting = consumers.map((consumer) => `"${consumer}"`).join(", ");
		throw new Error(
			`Batch "${name}" is waited on by ${waiting}; delete those batches or re-point their \`after\` first.`,
		);
	}

	return {
		...manifest,
		sequences: manifest.sequences.filter((entry) => entry.name !== name),
	};
}

export interface PromoteIssueParams {
	issue: string;
	/** Target sequence; typically the issue's conventional-commit scope. */
	sequence: string;
}

/**
 * - Lifts a gated issue into a sequence, creating that sequence when it does not exist yet.
 * - @param manifest - The queue manifest.
 * - @param params - The gated issue and its target sequence.
 * - @returns A manifest with the issue removed from `gated` and appended to the sequence.
 * - @throws {Error} When the issue is not gated, so promotion cannot silently rewrite a placement.
 */
export function promoteIssue(manifest: QueueManifest, params: PromoteIssueParams): QueueManifest {
	if (!manifest.gated.some((entry) => entry.issue === params.issue)) {
		throw new Error(
			`Issue #${params.issue} is not gated; use \`sandcastle queue add --issue ${params.issue} --sequence ${params.sequence}\` instead.`,
		);
	}

	const stripped: QueueManifest = {
		...manifest,
		gated: manifest.gated.filter((entry) => entry.issue !== params.issue),
	};

	if (!stripped.sequences.some((entry) => entry.name === params.sequence)) {
		return {
			...stripped,
			sequences: [...stripped.sequences, { issues: [params.issue], name: params.sequence }],
		};
	}

	return addToSequence(stripped, { issue: params.issue, sequence: params.sequence });
}

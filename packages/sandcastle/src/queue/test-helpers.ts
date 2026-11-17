/*
 * A fake {@link QueueContext} for the command layer's suites.
 *
 * The point of the context is that a caller crosses it, so the tests cross it too: a suite here names
 * no real reader, fetch, lock, or writer, and instead supplies the manifest, the live state, and the
 * gates it wants, then asserts the printed lines, the exit codes, and the manifest the command asked
 * to persist. Nothing touches the repository's own `sandcastle.queue.json` or a lock file.
 *
 * Every collaborator records its calls, so a spec can ask "was this refused before the transaction
 * started?" — the answer is "the transaction was never called" — rather than inferring it from a disk
 * state that a previous test may have left behind.
 */

import type { CliOptions } from "../cli.js";
import type { QueueContext, QueueOutput } from "./context.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import type { QueueManifest } from "./manifest.js";

/** Raised by the fake's `exit`, so a spec can assert the status the command chose. */
export class StopSignal extends Error {
	public readonly code: number;

	constructor(code: number) {
		super(`exit ${code}`);
		this.code = code;
	}
}

/** What a fake context was asked to do, and what it printed. */
export interface FakeQueueContext {
	/** Codes the command tried to exit with, in order. */
	codes: Array<number>;
	/** Everything printed, one entry per call, tagged with the channel it went to. */
	lines: Array<{ channel: "line" | "problem"; text: string }>;
	/** Manifests the command asked to persist, as `(summary, manifest)` pairs. */
	persisted: Array<{ manifest: QueueManifest; summary: string }>;
	/** Every manifest a transaction was handed, so a spec can prove none ran. */
	transactions: Array<QueueManifest>;
}

/** The live state a spec wants `fetchLive` to answer with. */
export interface FakeLive {
	/** Per-issue state; an absent number reads as not scanned, not as missing. */
	issues?: Record<string, Partial<LiveIssue> & { number?: string }>;
	/** Every open, ready-for-agent issue, for unplaced detection. */
	ready?: ReadonlyArray<{ number: string; title: string }>;
	/** Whether the `gh` page filled, which turns absence into "not scanned". */
	truncated?: boolean;
}

/** A full {@link LiveIssue} with the given overrides, defaulting to an open, ready issue. */
function liveIssue(number: string, overrides: Partial<LiveIssue> = {}): LiveIssue {
	return {
		found: true,
		number,
		openBlockers: [],
		ready: true,
		state: "OPEN",
		title: `Issue ${number}`,
		wayfinder: false,
		...overrides,
	};
}

/** The recorded calls, ready for assertions. */
export interface QueueContextStub {
	context: QueueContext;
	/** The manifest the fake starts from; a transaction's result replaces it. */
	readonly current: () => QueueManifest;
	readonly fake: FakeQueueContext;
}

/**
 * - Builds a context that reads one manifest, answers from canned live state, and records everything.
 * - @param manifest - The manifest every read and every transaction starts from.
 * - @param options - What the fake should answer for live state, gates, and the repository.
 * - @returns The context plus the recording and a reader of the current manifest.
 * - @remarks A transaction's returned `next` becomes the current manifest only if it differs, which
 *   is the real `transactQueueManifest` rule — so a spec asserting "nothing was written" is
 *   asserting the same no-op semantics production has, not a stub's simplification.
 */
export function queueContextStub(
	manifest: QueueManifest,
	options: {
		gates?: ReadonlyMap<string, string>;
		lanes?: { parallel: number; profiles: Array<string> };
		live?: FakeLive;
		repository?: { name: string; owner: string };
	} = {},
): QueueContextStub {
	let active = manifest;
	const fake: FakeQueueContext = { codes: [], lines: [], persisted: [], transactions: [] };
	const live: LiveQueueState = {
		issues: new Map(
			Object.entries(options.live?.issues ?? {}).map(([number, overrides]) => [
				number,
				liveIssue(number, overrides),
			]),
		),
		readyIssues: [...(options.live?.ready ?? [])],
		truncated: options.live?.truncated ?? false,
	};
	const output: QueueOutput = {
		/*
		 * Mirrors `emitJson` exactly, indentation included. A fake that always emitted compact JSON
		 * would accept a pretty payload and a JSONL record with the same bytes, so a spec could not
		 * tell the two contracts apart — which is how four document subcommands lost their indent
		 * unnoticed while a suite asserted "no output change".
		 */
		json: (value, pretty) => {
			fake.lines.push({
				channel: "line",
				text: pretty === true ? JSON.stringify(value, undefined, 2) : JSON.stringify(value),
			});
		},
		line: (line) => {
			fake.lines.push({ channel: "line", text: line });
		},
		problem: (line) => {
			fake.lines.push({ channel: "problem", text: line });
		},
	};

	const context: QueueContext = {
		chainDrift: () => [],
		enabled: (submitted) => submitted.queueEnabled ?? true,
		exit: (code) => {
			fake.codes.push(code);
			throw new StopSignal(code);
		},
		fetchLive: () => live,
		gates: () => options.gates ?? new Map<string, string>(),
		lanes: () => options.lanes ?? { parallel: 1, profiles: [] },
		manifestPath: () => "sandcastle.queue.json",
		output,
		overwrite: (_, next, summary) => {
			fake.persisted.push({ manifest: next, summary });
			active = next;
		},
		readManifest: () => active,
		readRawManifest: () => active,
		repository: () => options.repository ?? { name: "rbxts", owner: "lisachandra" },
		transact: (_, transact) => {
			fake.transactions.push(active);
			const { message, next, summary } = transact(active);
			if (message !== undefined) {
				output.line(message);
			}

			if (next !== active) {
				fake.persisted.push({ manifest: next, summary });
				active = next;
			}

			return next;
		},
	};

	return { context, current: () => active, fake };
}

/**
 * - A context built around the given manifest, with every collaborator defaulted.
 * - @param manifest - The manifest the command reads and mutates.
 * - @param options - Optional live, gate, and repository answers.
 * - @returns The {@link QueueContextStub}; destructure what a spec needs.
 */
export function fakeQueueContext(
	manifest: QueueManifest,
	options: Parameters<typeof queueContextStub>[1] = {},
): QueueContextStub {
	return queueContextStub(manifest, options);
}

/** The lines a command printed on the human channel, joined for a single regex assertion. */
export function humanText(fake: FakeQueueContext): string {
	return fake.lines
		.filter((entry) => entry.channel === "line")
		.map((entry) => entry.text)
		.join("\n");
}

/** The lines a command printed as problems, joined. */
export function problemText(fake: FakeQueueContext): string {
	return fake.lines
		.filter((entry) => entry.channel === "problem")
		.map((entry) => entry.text)
		.join("\n");
}

/**
 * - A CLI options bag for a queue subcommand, without the real parser's cross-field checks.
 * - @param argv - Arguments as they would be typed after `sandcastle queue`.
 * - @returns Parsed options.
 * - @remarks The real parser is used because these specs are asserting the command layer, not the
 *   flags; a flag that does not parse is a parser test's business.
 */
export type QueueOptions = CliOptions;

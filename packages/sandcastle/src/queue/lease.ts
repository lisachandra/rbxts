/*
 * Cross-machine dispatch lease: one dispatcher per repository, not just per checkout.
 *
 * The locks in `lock.ts` are files in one working tree, so they say nothing to a second machine
 * running against the same repository. A lease ref on `origin` is the one piece of shared state every
 * checkout can read and write, and a git ref is a natural compare-and-swap: `push --force-with-lease`
 * succeeds only against the sha the caller last observed.
 *
 * The ref points at a root commit whose *message* is the JSON payload. A commit is used rather than a
 * blob or a tree because `commit-tree` takes the content as an argument — no stdin plumbing, no
 * `hash-object` dance — and `git log -1 --format=%B` reads it back without a second command.
 *
 * Acquisition is an atomic CAS: read the current sha (or none), then push with that sha as the
 * expectation. The loser of a race is refused rather than retried, because the winner is a live
 * dispatcher and the loser has nothing useful to do.
 *
 * The lease expires so a crashed machine cannot wedge the queue: a payload older than the TTL is
 * taken over. A live dispatcher renews well inside the TTL, which is what makes "expired" and "dead"
 * the same statement. Losing the lease to a renewal CAS does not interrupt an in-flight agent call —
 * it flips {@link LeaseHandle.lost}, and the dispatcher stops at the next batch boundary.
 */

import { hostname } from "node:os";

import type { QueueLeaseMode } from "../config.js";
import { git } from "../git.js";
import { config } from "../runtime.js";

/** The ref a checkout holds while it dispatches. */
export const leaseRef = "refs/sandcastle/dispatch-lease";

/** How long a lease stays valid without a renewal. */
export const leaseTtlMs = 30 * 60 * 1000;

/** How often a live dispatcher renews; three renewals fit inside one TTL. */
export const leaseRenewMs = 10 * 60 * 1000;

/** The empty tree, which every commit needs and no lease content uses. */
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** What a holder writes to the lease commit's message. */
export interface LeasePayload {
	/** Epoch milliseconds at which the lease was last renewed. */
	at: number;
	/** Branch the holder's checkout is on, for the human reading a refusal. */
	branch: string;
	host: string;
	pid: number;
}

/** A held lease, or a run that decided to dispatch locally. */
export interface LeaseHandle {
	/**
	 * `lease` when the remote ref is held, `local` when the run degraded to the pre-lease behavior.
	 * A `local` handle makes every later call a no-op, including renewals.
	 */
	kind: "lease" | "local";
	/**
	 * Whether this run lost the lease after taking it. The dispatcher checks this at a batch
	 * boundary: stopping there is safe, whereas interrupting a phase mid-flight is not.
	 */
	lost: () => boolean;
	/** Releases the lease (or does nothing for a local handle); safe to call twice. */
	release: () => void;
}

/** Seams so tests never touch the network or the clock. */
export interface LeaseOptions {
	/** Mode override; defaults to `config.queue.lease`. */
	mode?: QueueLeaseMode;
	/** Current epoch milliseconds; defaults to `Date.now`. */
	now?: () => number;
	/** Overrides the renewal interval so a test does not wait minutes. */
	renewMs?: number;
	/** Shell runner; defaults to the git plumbing in `../git.js`. */
	run?: (args: ReadonlyArray<string>) => string;
	/** Overrides the validity window. */
	ttlMs?: number;
}

/** One git command attempt, keeping git's message so a CAS loss differs from a transport fault. */
interface Attempt {
	error?: string;
	ok: boolean;
	output: string;
}

/** Runs one git command without letting a failure escape. */
function attempt(
	run: (args: ReadonlyArray<string>) => string,
	args: ReadonlyArray<string>,
): Attempt {
	try {
		return { ok: true, output: run(args) };
	} catch (err) {
		return { error: String(err), ok: false, output: "" };
	}
}

/**
 * Whether a failed `push` was a lease rejection rather than a transport problem.
 *
 * @remarks
 *   Git reports a lost `--force-with-lease` as "stale info" or "[rejected]". A network failure says
 *   something else entirely, and conflating the two would tell an operator to delete a ref that was
 *   never pushed — or worse, to treat an unreachable remote as a lost race and abort.
 */
function isLeaseRejection(result: Attempt): boolean {
	return /stale info|\[rejected\]|failed to push some refs/iu.test(result.error ?? "");
}

/**
 * - Reads the lease payload currently published locally, if any.
 * - @param run - Shell runner.
 * - @returns The payload and its commit sha, or `undefined` when no lease is published.
 * - @remarks A payload that does not parse reads as no lease: taking it over is safer than refusing
 *   to dispatch over an artifact nobody understands.
 */
function readLease(
	run: (args: ReadonlyArray<string>) => string,
): undefined | { payload: LeasePayload; sha: string } {
	/*
	 * The lease ref always points at a commit, so no `^{commit}` peel is needed — which also keeps
	 * git's brace syntax out of a template literal.
	 */
	const head = attempt(run, ["rev-parse", "--verify", "--quiet", leaseRef]);
	if (!head.ok || head.output === "") {
		return undefined;
	}

	const sha = head.output.trim();
	const message = attempt(run, ["log", "-1", "--format=%B", sha]);
	if (!message.ok) {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(message.output.trim());
	} catch {
		return undefined;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return undefined;
	}

	const candidate = parsed as Record<string, unknown>;
	if (typeof candidate.at !== "number" || typeof candidate.host !== "string") {
		return undefined;
	}

	return {
		payload: {
			at: candidate.at,
			branch: typeof candidate.branch === "string" ? candidate.branch : "unknown",
			host: candidate.host,
			pid: typeof candidate.pid === "number" ? candidate.pid : 0,
		},
		sha,
	};
}

/** Creates a lease commit whose message is `payload`; returns the attempt carrying the new sha. */
function createLeaseCommit(
	run: (args: ReadonlyArray<string>) => string,
	payload: LeasePayload,
): Attempt {
	return attempt(run, [
		"-c",
		"user.name=sandcastle",
		"-c",
		"user.email=sandcastle@localhost",
		"commit-tree",
		emptyTree,
		"-m",
		JSON.stringify(payload),
	]);
}

/**
 * - Pushes `sha` to the lease ref, allowed only if the remote still holds `expect`.
 * - @param expect - Sha the caller believes is there; `""` asserts the ref is absent.
 * - @returns The attempt, so the caller can tell a lost CAS from an unreachable remote.
 * - @remarks `--no-verify` is required, not an optimization. The lease ref points at an empty tree
 *   that no CI builds, but a repository's `pre-push` hook cannot know that: this repo's runs
 *   `typecheck`, `lint:fix`, and `build`, which would add minutes to every acquisition and every
 *   10-minute renewal — and `lint:fix` rewrites files in a working tree an agent may be editing.
 */
function pushLease(
	run: (args: ReadonlyArray<string>) => string,
	sha: string,
	expect: string,
): Attempt {
	return attempt(run, [
		"push",
		"--no-verify",
		`--force-with-lease=${leaseRef}:${expect}`,
		"origin",
		`${sha}:${leaseRef}`,
	]);
}

/** Deletes the lease ref remotely, but only from `sha`, then drops the local ref. */
function deleteLease(run: (args: ReadonlyArray<string>) => string, sha: string): void {
	attempt(run, [
		"push",
		"--no-verify",
		`--force-with-lease=${leaseRef}:${sha}`,
		"origin",
		`:${leaseRef}`,
	]);
	attempt(run, ["update-ref", "-d", leaseRef]);
}

/** Whether `origin` exists, so `auto` can decide whether a lease is even possible. */
function hasOrigin(run: (args: ReadonlyArray<string>) => string): boolean {
	const remotes = attempt(run, ["remote"]);
	if (!remotes.ok) {
		return false;
	}

	return remotes.output.split(/\r?\n/u).some((line) => line.trim() === "origin");
}

/** Human description of a holder, for a refusal. */
function describeHolder(payload: LeasePayload, now: number, ttlMs: number): string {
	const ageMinutes = Math.max(0, Math.round((now - payload.at) / 60_000));
	const expiresInMinutes = Math.max(0, Math.round((payload.at + ttlMs - now) / 60_000));
	return `pid ${String(payload.pid)} on ${payload.host} (branch ${payload.branch}), renewed ${String(ageMinutes)}m ago, expires in ${String(expiresInMinutes)}m`;
}

/** Current branch name, or a placeholder when the checkout is detached. */
function currentBranch(run: (args: ReadonlyArray<string>) => string): string {
	const branch = attempt(run, ["rev-parse", "--abbrev-ref", "HEAD"]);
	return branch.ok && branch.output !== "" ? branch.output.trim() : "unknown";
}

/**
 * - Refreshes the local lease ref from `origin`, clearing it when the remote has none.
 * - @returns The transport failure, or `undefined` when the local ref now matches the remote.
 * - @remarks `ls-remote` distinguishes "no lease published" — the case with no contention, which must
 *   clear any stale local ref — from "cannot reach the remote", which must be reported. Reading a
 *   stale local ref is what would let two dispatchers both believe they hold the lease.
 */
function syncLeaseRef(run: (args: ReadonlyArray<string>) => string): string | undefined {
	const remote = attempt(run, ["ls-remote", "origin", leaseRef]);
	if (!remote.ok) {
		return "`git ls-remote origin` failed";
	}

	if (remote.output.trim() === "") {
		attempt(run, ["update-ref", "-d", leaseRef]);
		return undefined;
	}

	const fetched = attempt(run, ["fetch", "--quiet", "origin", `+${leaseRef}:${leaseRef}`]);
	return fetched.ok ? undefined : "`git fetch origin` failed";
}

/**
 * - Takes, renews, and releases the cross-machine dispatch lease.
 * - @param options - Mode, clock, and shell seams.
 * - @returns A handle; `kind` reports whether the remote ref is actually held.
 * - @throws {Error} When another checkout holds a live lease, another checkout wins the acquisition
 *   race, or `strict` mode cannot take a lease.
 * - @remarks `auto` degrades to `local` on any transport failure — no `origin`, no network, no push
 *   rights — because a single-machine checkout must keep working offline. That trade is
 *   one-directional: a run that believes it holds the lease may be wrong, and the local lock
 *   protocol is what keeps that safe.
 */
export function acquireDispatchLease(options: LeaseOptions = {}): LeaseHandle {
	const mode = options.mode ?? config.queue.lease;
	if (mode === "off") {
		return { kind: "local", lost: () => false, release: () => undefined };
	}

	const now = options.now ?? Date.now;
	const run = options.run ?? ((args: ReadonlyArray<string>) => git(args));
	const ttlMs = options.ttlMs ?? leaseTtlMs;
	const renewMs = options.renewMs ?? leaseRenewMs;

	const degrade = (reason: string): LeaseHandle => {
		if (mode === "strict") {
			throw new Error(
				`queue.lease is "strict" but the cross-machine dispatch lease could not be taken: ${reason}`,
			);
		}

		console.error(
			`  ⚠ Cross-machine dispatch lease unavailable (${reason}); dispatching with local locks only.`,
		);
		return { kind: "local", lost: () => false, release: () => undefined };
	};

	if (!hasOrigin(run)) {
		return degrade("this checkout has no `origin` remote");
	}

	const syncError = syncLeaseRef(run);
	if (syncError !== undefined) {
		return degrade(syncError);
	}

	const existing = readLease(run);
	const stamp = now();

	if (existing !== undefined) {
		if (stamp - existing.payload.at < ttlMs) {
			throw new Error(
				`Another checkout is dispatching this queue: ${describeHolder(existing.payload, stamp, ttlMs)}. Run \`git push origin :${leaseRef}\` only if that machine is gone.`,
			);
		}

		console.error(
			`  ⚠ Taking over an expired dispatch lease (${describeHolder(existing.payload, stamp, ttlMs)}).`,
		);
	}

	const payload: LeasePayload = {
		at: stamp,
		branch: currentBranch(run),
		host: hostname(),
		pid: process.pid,
	};

	const created = createLeaseCommit(run, payload);
	if (!created.ok) {
		return degrade(`could not create the lease commit (${created.error ?? "unknown error"})`);
	}

	let sha = created.output.trim();
	if (!attempt(run, ["update-ref", leaseRef, sha]).ok) {
		return degrade("could not write the local lease ref");
	}

	const first = pushLease(run, sha, existing?.sha ?? "");
	if (!first.ok) {
		attempt(run, ["update-ref", "-d", leaseRef]);
		if (isLeaseRejection(first)) {
			throw new Error(
				`Another checkout took the dispatch lease while this one was acquiring it. Retry once it finishes, or \`git push origin :${leaseRef}\` if it is stale.`,
			);
		}

		return degrade(`\`git push origin\` failed (${first.error ?? "unknown error"})`);
	}

	let released = false;
	let lost = false;

	const heartbeat = setInterval(() => {
		/*
		 * Renewing is a fresh CAS against our own sha. Failing it means someone else now holds the
		 * ref — an expired-and-taken-over lease, or a manual force push — so this run's claim is no
		 * longer exclusive and it must stop rather than keep dispatching under a lease it lost.
		 */
		const renewed: LeasePayload = { ...payload, at: now() };
		const next = createLeaseCommit(run, renewed);
		if (!next.ok) {
			console.error(
				`  ⚠ Could not renew the dispatch lease (${next.error ?? "unknown error"}); continuing, but the lease may expire.`,
			);
			return;
		}

		const pushed = pushLease(run, next.output.trim(), sha);
		if (pushed.ok) {
			sha = next.output.trim();
			return;
		}

		if (!isLeaseRejection(pushed)) {
			console.error(
				`  ⚠ Could not renew the dispatch lease (${pushed.error ?? "unknown error"}); continuing, but the lease may expire.`,
			);
			return;
		}

		lost = true;
		clearInterval(heartbeat);
		console.error(
			"  ✗ Lost the dispatch lease to another checkout; stopping at the next batch boundary so two dispatchers cannot overlap.",
		);
	}, renewMs);
	heartbeat.unref();

	return {
		kind: "lease",
		lost: () => lost,
		release: () => {
			if (released) {
				return;
			}

			released = true;
			clearInterval(heartbeat);
			if (!lost) {
				deleteLease(run, sha);
			}
		},
	};
}

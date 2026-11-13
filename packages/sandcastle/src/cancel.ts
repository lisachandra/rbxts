/*
 * Process-wide cancellation for `queue run`.
 *
 * Node's default `SIGINT` behavior kills the process without unwinding, so every `finally` that
 * releases the run lock, a batch lock, or the cross-machine lease is skipped, and a `--parallel`
 * pool leaves its lane children running. Both then cost a blind wait before the next run can
 * dispatch: ten minutes for a lock, thirty for the lease.
 *
 * A signal handler that only *records* the request fixes that without killing anything itself. The
 * dispatcher checks it at the batch boundary, the phase pipeline subscribes to the same signal so an
 * in-flight agent is aborted, and the normal control flow reaches the `finally` blocks that release
 * what this process holds.
 *
 * Only `queue run` installs these handlers. `queue serve` prints "Ctrl+C stops it" and relies on
 * Node's default terminate, so capturing the signal there would break it.
 */

import { Cancellation } from "./cancellation.js";

/** Exit code for a cancelled run, matching the shell's convention for `SIGINT` (128 + 2). */
export const cancelledExitCode = 130;

/**
 * Raised as the abort reason when an operator cancels.
 *
 * Distinct from every provider failure so the retry loop can refuse to retry it: a cancelled phase
 * that retried would sleep through the backoff and resume work the operator just stopped.
 */
export class CancelError extends Error {
	public override name = "CancelError";

	constructor() {
		super("Cancelled by the operator.");
	}
}

/**
 * The cancellation request for this process, re-exported from `cancellation.ts`.
 *
 * One import for "the thing that says stop": callers never need to know which module owns it.
 */
export { Cancellation } from "./cancellation.js";

/** The cancellation request for this process. */
export const cancellation = new Cancellation();

/** Signals that ask a run to stop, most-specific first. */
const cancelSignals = ["SIGINT", "SIGTERM"] as const;

/**
 * - Installs the signal handlers that make `Ctrl+C` cancel instead of kill.
 * - @param onRequest - Prints the one line telling the operator what happened and how to hard-kill.
 * - @returns A dispose function that removes both handlers; call it in a `finally`.
 * - @remarks The first signal requests cancellation and lets the run unwind, which is what releases
 *   locks and the lease. The second signal is the operator's escape from a wedged agent, so it
 *   exits immediately — a handler that swallowed it would leave no way out short of a task
 *   manager.
 */
export function installCancelHandlers(onRequest: () => void): () => void {
	let signalled = 0;

	const handler = (): void => {
		signalled += 1;
		if (signalled > 1) {
			console.error(
				`  ✗ Hard-killed on the second ${cancelSignals.join("/")}; locks may remain.`,
			);
			process.exit(cancelledExitCode);
		}

		onRequest();
		cancellation.request();
	};

	for (const signal of cancelSignals) {
		process.on(signal, handler);
	}

	return () => {
		for (const signal of cancelSignals) {
			process.off(signal, handler);
		}
	};
}

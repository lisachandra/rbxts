/*
 * One cancellation request and the signal that carries it.
 *
 * Separate from `cancel.ts` (which owns the process-wide singleton and the signal handlers) so the
 * test suite can construct instances, and because the repo allows one class per file.
 */

import { CancelError } from "./cancel.js";

/**
 * One cancellation request and the signal that carries it.
 *
 * A class rather than module-level state so tests construct their own instance; production uses the
 * `cancellation` singleton in `cancel.ts`.
 */
export class Cancellation {
	#controller = new AbortController();

	/**
	 * Aborted once when {@link request} is called, and re-created by {@link reset}.
	 *
	 * A getter rather than a stored field so `reset` can hand out a fresh signal: an `AbortSignal`
	 * cannot be un-aborted, so a new controller is the only way to clear a request.
	 */
	public get signal(): AbortSignal {
		return this.#controller.signal;
	}

	/** Whether an operator asked this process to stop. */
	public requested(): boolean {
		return this.#controller.signal.aborted;
	}

	/**
	 * - Requests cancellation.
	 * - @remarks Idempotent: a second call leaves the first abort reason in place, so a signal
	 *   delivered twice cannot overwrite why the run stopped.
	 */
	public request(): void {
		if (this.#controller.signal.aborted) {
			return;
		}

		this.#controller.abort(new CancelError());
	}

	/**
	 * - Clears the request, so the next run in this process starts uncancelled.
	 * - @remarks A subscriber that already captured the old signal keeps its aborted state, which is
	 *   what it should see: its work was cancelled.
	 */
	public reset(): void {
		this.#controller = new AbortController();
	}
}

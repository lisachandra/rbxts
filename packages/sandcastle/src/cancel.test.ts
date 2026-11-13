import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
	CancelError,
	Cancellation,
	cancellation,
	cancelledExitCode,
	installCancelHandlers,
} from "./cancel.js";
import { registerTestHooks } from "./test-helpers.js";

registerTestHooks();

/** Collects the lines a stubbed `console.error` received, without touching real streams. */
function captureError(run: () => void): Array<string> {
	const lines: Array<string> = [];
	const original = console.error;
	console.error = (...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	};

	try {
		run();
	} finally {
		console.error = original;
	}

	return lines;
}

/**
 * The handler `installCancelHandlers` just registered.
 *
 * Called directly instead of emitting a real signal: the test runner installs its own signal
 * listeners, so emitting would run those too. The last listener is the one installed here, because
 * registration happens synchronously inside the call under test.
 */
function installedHandler(): () => void {
	const handler = process.listeners("SIGINT").at(-1);
	assert.ok(handler !== undefined, "installCancelHandlers must register a SIGINT listener");
	return handler as () => void;
}

describe("cancellation", () => {
	test("starts uncancelled and aborts with a CancelError", () => {
		const subject = new Cancellation();

		assert.equal(subject.requested(), false);
		assert.equal(subject.signal.aborted, false);

		subject.request();

		assert.equal(subject.requested(), true);
		assert.equal(subject.signal.aborted, true);
		assert.ok(subject.signal.reason instanceof CancelError);
	});

	test("request is idempotent and keeps the first abort reason", () => {
		const subject = new Cancellation();
		subject.request();
		const { reason } = subject.signal;

		subject.request();

		assert.equal(
			subject.signal.reason,
			reason,
			"a repeated request must not overwrite why the run stopped",
		);
	});

	test("request fires the abort event once, not once per call", () => {
		const subject = new Cancellation();
		let fired = 0;
		subject.signal.addEventListener("abort", () => {
			fired += 1;
		});

		subject.request();
		subject.request();
		subject.request();

		assert.equal(fired, 1);
	});

	test("reset restores a state with no request and hands out a fresh signal", () => {
		const subject = new Cancellation();
		const original = subject.signal;
		subject.request();

		subject.reset();

		assert.equal(subject.requested(), false);
		assert.notEqual(subject.signal, original, "an aborted signal cannot be reused");
		assert.equal(original.aborted, true, "subscribers that captured the old signal keep it");
	});

	test("a request after reset aborts the new generation only", () => {
		const subject = new Cancellation();
		subject.request();
		subject.reset();
		const fresh = subject.signal;

		subject.request();

		assert.equal(subject.requested(), true);
		assert.ok(fresh.aborted);
	});

	test("a CancelError is named for the retry loop's fatal check", () => {
		assert.equal(new CancelError().name, "CancelError");
		assert.match(new CancelError().message, /Cancelled by the operator/u);
	});
});

describe("cancel handlers", () => {
	test("the first signal requests cancellation and prints nothing itself", () => {
		const before = process.listenerCount("SIGINT");
		let disposed = (): void => undefined;
		let requested = 0;

		const errors = captureError(() => {
			disposed = installCancelHandlers(() => {
				requested += 1;
			});
		});

		try {
			assert.equal(process.listenerCount("SIGINT"), before + 1);
			assert.equal(process.listenerCount("SIGTERM"), before + 1);
			assert.deepEqual(errors, [], "installing must not print");

			installedHandler()();

			assert.equal(requested, 1, "the callback is what tells the operator what happened");
			assert.equal(cancellation.requested(), true);
		} finally {
			disposed();
			cancellation.reset();
		}

		assert.equal(process.listenerCount("SIGINT"), before);
		assert.equal(process.listenerCount("SIGTERM"), before);
	});

	test("the second signal hard-kills with the cancelled exit code", () => {
		let disposed = (): void => undefined;
		const exitCodes: Array<number> = [];
		const originalExit = process.exit;

		/*
		 * `process.exit` is stubbed rather than observed in a child process: the handler calls it
		 * directly, and the stub throws so this test keeps running instead of ending the suite.
		 */
		process.exit = ((code?: number) => {
			exitCodes.push(code ?? 0);
			throw new Error("hard exit");
		}) as typeof process.exit;

		try {
			disposed = installCancelHandlers(() => undefined);
			const handler = installedHandler();

			handler();
			assert.deepEqual(exitCodes, [], "the first signal must unwind, not exit");

			const errors = captureError(() => {
				assert.throws(
					() => {
						handler();
					},
					(err: unknown) => err instanceof Error && err.message === "hard exit",
				);
			});
			assert.deepEqual(exitCodes, [cancelledExitCode]);
			assert.match(errors.join("\n"), /Hard-killed on the second SIGINT\/SIGTERM/u);
		} finally {
			process.exit = originalExit;
			cancellation.reset();
			disposed();
		}
	});

	test("disposing twice is harmless", () => {
		const dispose = installCancelHandlers(() => undefined);

		dispose();

		assert.doesNotThrow(() => {
			dispose();
		});
	});

	test("the exit code is the shell's SIGINT convention", () => {
		assert.equal(cancelledExitCode, 130);
	});
});

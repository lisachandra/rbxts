import type { CommandContext } from "@rbxts/centurion";
import Log from "@rbxts/log";

/**
 * One guard a test drives, with the command it belongs to when the test knows.
 *
 * `guard` is typed `unknown` rather than `boolean` on purpose: a guard that returns a `Promise` or
 * `nil` is exactly what {@link assertGuardsReturnBoolean} exists to catch, and a `boolean` return
 * type would make that a type error at the test site instead of an assertion failure.
 */
export interface GuardCase {
	/** The command the guard protects, named in the failure message when known. */
	command?: string;
	/** The guard under test, called with the supplied context. */
	guard: (context: CommandContext) => unknown;
	/** A label for the guard, so a failure names which one misbehaved. */
	name: string;
}

/**
 * Asserts that every guard returns a `boolean` for `context`, halting when one does not.
 *
 * @remarks
 *   Centurion evaluates a guard as `if not guard(context) then return nil end`, so only `false` and
 *   `nil` deny. A guard returning a `Promise`, a table, or a non-empty string is truthy there and
 *   the command runs — an async guard is a silent authorization bypass, not a rejected one. That is
 *   why this asserts on the return **type** rather than on truthiness. `false` passes: it is a
 *   boolean, and denying a caller is a legitimate outcome. The check is "would centurion read this
 *   as a decision", not "did it admit this caller". Call this from a test with a fake context (see
 *   `test/platform/src/guard.spec.ts` for the shape) so an async guard fails the suite instead of
 *   shipping. It halts through `Log.Fatal`, which is typed `never` and fails closed even when no
 *   sink is installed.
 * @param cases - The guards to check, each with a name for the failure message.
 * @param context - The command context to call each guard with.
 */
export function assertGuardsReturnBoolean(
	cases: ReadonlyArray<GuardCase>,
	context: CommandContext,
): void {
	for (const guardCase of cases) {
		const result = guardCase.guard(context);
		if (type(result) === "boolean") {
			continue;
		}

		const command =
			guardCase.command === undefined ? "" : ` for command "${guardCase.command}"`;
		/*
		 * `type()` reports a `Promise` as "table", which is the useful fact either way: what matters is
		 * that centurion would have read it as truthy. The advice names the likely cause because an
		 * un-awaited promise is far and away the common one.
		 */
		Log.Fatal(
			`Guard "${guardCase.name}"${command} returned ${type(result)}, not boolean — centurion evaluates guards synchronously, so a truthy non-boolean permits the command. If the guard is async, resolve the authorization before it runs.`,
		);
	}
}

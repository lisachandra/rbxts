import type { GuardCase } from "@lisachandra/platform/centurion/testing";
import { assertGuardsReturnBoolean } from "@lisachandra/platform/centurion/testing";
import type { CommandContext } from "@rbxts/centurion";
import { CommandContext as CenturionContext, RegistryPath } from "@rbxts/centurion";
import { describe, expect, it } from "@rbxts/jest-globals";

/** A real command context; the guards under test ignore it. */
function context(): CommandContext {
	const player = { GetRoleInGroup: () => "", Name: "Tester", UserId: 1 } as unknown as Player;

	return new CenturionContext(
		player,
		RegistryPath.fromString("test"),
		[],
		"test",
	) as unknown as CommandContext;
}

/**
 * Runs `assertGuardsReturnBoolean` and returns the thrown message, or `undefined` when it passed.
 *
 * The helper halts through `Log.Fatal`, which throws in this lane, so `pcall` is how a test
 * observes that it halted at all — the assertion's whole contract is "this does not return".
 */
function messageFrom(guardCase: GuardCase): string | undefined {
	const [ok, message] = pcall(() => {
		assertGuardsReturnBoolean([guardCase], context());
	});

	return ok ? undefined : tostring(message);
}

describe("assertGuardsReturnBoolean", () => {
	it("should accept a guard that returns true", () => {
		expect.assertions(1);

		expect(messageFrom({ guard: () => true, name: "allowAll" })).toBeUndefined();
	});

	it("should accept a guard that returns false", () => {
		expect.assertions(1);

		/*
		 * `false` is a decision, not a defect: Centurion's `if not guard(context)` check reads it as
		 * a denial. The assertion is about the return type, so denying a caller must not fail.
		 */
		expect(messageFrom({ guard: () => false, name: "denyAll" })).toBeUndefined();
	});

	it("should throw naming the guard when it returns a Promise", () => {
		expect.assertions(2);

		const message = messageFrom({
			/*
			 * The #67 regression: this guard is typed as returning a boolean through a cast, exactly
			 * as an async guard's promise flows through centurion's `(context) => boolean` shape.
			 */
			guard: (() => Promise.resolve(true)) as unknown as () => boolean,
			name: "asyncGuard",
		});

		expect(message).toContain("asyncGuard");
		expect(message).toContain("not boolean");
	});

	it("should name the command when the case supplies one", () => {
		expect.assertions(1);

		const message = messageFrom({
			command: "kick",
			guard: () => "yes",
			name: "stringGuard",
		});

		expect(message).toContain('for command "kick"');
	});

	it("should throw when a guard returns nil or a table", () => {
		expect.assertions(2);

		expect(messageFrom({ guard: () => undefined, name: "nilGuard" })).toContain("nil");
		expect(messageFrom({ guard: () => ({ ok: true }), name: "tableGuard" })).toContain("table");
	});

	it("should check every case, not just the first", () => {
		expect.assertions(1);

		const [ok, message] = pcall(() => {
			assertGuardsReturnBoolean(
				[
					{ guard: () => true, name: "fine" },
					{ guard: () => 42, name: "numeric" },
				],
				context(),
			);
		});

		expect(ok ? "passed" : tostring(message)).toContain("numeric");
	});
});

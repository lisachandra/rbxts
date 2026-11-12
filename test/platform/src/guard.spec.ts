import {
	adminOrDeveloper,
	authorize,
	configureCenturionGroup,
	configureCenturionRoles,
	configureCenturionUsers,
	createAuthorizationPolicy,
} from "@lisachandra/platform/centurion/guards";
import type { CommandContext } from "@rbxts/centurion";
import { CommandContext as CenturionContext, RegistryPath } from "@rbxts/centurion";
import { describe, expect, it } from "@rbxts/jest-globals";

/**
 * The documented default allowlist. Every rejection case below is a role that substring matching
 * would have admitted, which is what made this a privilege escalation rather than a style issue.
 */
const ROLES = ["Developer", "Founder"];

/** Roles that contain an allowed role as a substring but are not that role. */
const NEAR_MISSES = [
	"Developer Intern",
	"Junior Developer",
	"Senior Game Developer",
	"Ex-Developer",
	"Founding Developer",
	"Co-Founder",
	"Developers",
	"Founder ",
];

/** A policy built from the default allowlist, used by the pure cases. */
function defaultPolicy() {
	return createAuthorizationPolicy(ROLES, []);
}

/** A player whose role and id are under the test's control. */
function playerWithRole(role: string, userId = 1): Player {
	return { GetRoleInGroup: () => role, Name: "Tester", UserId: userId } as unknown as Player;
}

/** A real centurion command context, so the guard's denial path is observed through its reply. */
function contextFor(player: Player): CommandContext {
	return new CenturionContext(
		player,
		RegistryPath.fromString("test"),
		[],
		"test",
	) as unknown as CommandContext;
}

/** Restores the guard to its documented default allowlist between cases. */
function resetConfiguration(): void {
	configureCenturionRoles([...ROLES]);
	configureCenturionUsers([]);
	configureCenturionGroup(0);
}

describe("authorize", () => {
	it.each(NEAR_MISSES)("should refuse the near-miss role $role", (role) => {
		expect.assertions(1);

		expect(authorize({ role, userId: 1 }, defaultPolicy())).toBe(false);
	});

	it.each(ROLES)("should admit the exact role $role", (role) => {
		expect.assertions(1);

		expect(authorize({ role, userId: 1 }, defaultPolicy())).toBe(true);
	});

	it("should refuse an empty role, which is what a non-member has", () => {
		expect.assertions(1);

		expect(authorize({ role: "", userId: 1 }, defaultPolicy())).toBe(false);
	});

	it("should refuse a member whose role was never observed", () => {
		expect.assertions(1);

		expect(authorize({ userId: 1 }, defaultPolicy())).toBe(false);
	});

	it("should admit an allowlisted user id regardless of role", () => {
		expect.assertions(1);

		const policy = createAuthorizationPolicy(ROLES, [42]);

		expect(authorize({ role: "Developer Intern", userId: 42 }, policy)).toBe(true);
	});

	it("should deny every player when nothing is configured", () => {
		expect.assertions(2);

		const empty = createAuthorizationPolicy([], []);

		expect(authorize({ role: "Developer", userId: 1 }, empty)).toBe(false);
		expect(authorize({ role: "developer", userId: 1 }, empty)).toBe(false);
	});

	it("should fold case on the role but still refuse a longer rank", () => {
		expect.assertions(2);

		expect(authorize({ role: "developer", userId: 1 }, defaultPolicy())).toBe(true);
		expect(authorize({ role: "junior developer", userId: 1 }, defaultPolicy())).toBe(false);
	});

	it("should fold case on the configured role too", () => {
		expect.assertions(1);

		const policy = createAuthorizationPolicy(["developer"], []);

		expect(authorize({ role: "Developer", userId: 1 }, policy)).toBe(true);
	});
});

describe("adminOrDeveloper", () => {
	it.each(NEAR_MISSES)("should deny command execution to the near-miss role $role", (role) => {
		expect.assertions(3);

		resetConfiguration();
		const context = contextFor(playerWithRole(role));

		expect(adminOrDeveloper(context)).toBe(false);
		expect(context.isReplyReceived()).toBe(true);
		expect(context.getReply()?.text).toContain("Tester");
	});

	it.each(ROLES)("should allow command execution to the exact role $role", (role) => {
		expect.assertions(2);

		resetConfiguration();
		const context = contextFor(playerWithRole(role));

		expect(adminOrDeveloper(context)).toBe(true);
		expect(context.isReplyReceived()).toBe(false);
	});

	it("should allow an allowlisted user id even with an unrelated role", () => {
		expect.assertions(1);

		resetConfiguration();
		configureCenturionUsers([42]);
		const context = contextFor(playerWithRole("Developer Intern", 42));

		expect(adminOrDeveloper(context)).toBe(true);
	});

	it("should deny when no roles and no users are configured", () => {
		expect.assertions(2);

		resetConfiguration();
		configureCenturionRoles([]);
		const context = contextFor(playerWithRole("Developer"));

		expect(adminOrDeveloper(context)).toBe(false);
		expect(context.isReplyReceived()).toBe(true);
	});

	it("should report the executor name on denial", () => {
		expect.assertions(1);

		resetConfiguration();
		const context = contextFor(playerWithRole(""));

		adminOrDeveloper(context);

		expect(context.getReply()?.text).toContain("Tester");
	});
});

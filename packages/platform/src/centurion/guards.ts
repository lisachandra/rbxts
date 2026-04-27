import type { CommandContext } from "@rbxts/centurion";

import { includes } from "@lisachandra/core/out/utils/string";

let groupId = 0;
const allowedRoles = ["Developer", "Founder"];

/**
 * Configures the Roblox group ID used for centurion command authorization.
 *
 * @param id - The Roblox group ID to check roles against.
 */
export function configureCenturionGroup(id: number): void {
	groupId = id;
}

/**
 * Configures which group roles are authorized to run admin commands.
 * Default: `["Developer", "Founder"]`
 */
export function configureCenturionRoles(roles: Array<string>): void {
	allowedRoles.clear();
	for (const role of roles) {
		allowedRoles.push(role);
	}
}

export function adminOrDeveloper(context: CommandContext): boolean {
	const role = context.executor.GetRoleInGroup(groupId);
	for (const allowed of allowedRoles) {
		if (includes(role, allowed)) {
			return true;
		}
	}

	context.error(
		`Insufficient permissions for ${context.executor.Name} (${context.getData()})`,
	);
	return false;
}

import { includes } from "@lisachandra/core/utils/string";
import type { CommandContext } from "@rbxts/centurion";

let groupId = 0;
const allowedUserIds = new Array<number>();
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
 * Configures which group roles are authorized to run admin commands. Default: `["Developer",
 * "Founder"]`.
 */
export function configureCenturionRoles(roles: Array<string>): void {
	allowedRoles.clear();
	for (const role of roles) {
		allowedRoles.push(role);
	}
}

/**
 * Configures which Roblox user IDs are authorized to run admin commands.
 *
 * @param userIds - The Roblox user IDs that should bypass group-role checks.
 */
export function configureCenturionUsers(userIds: Array<number>): void {
	allowedUserIds.clear();
	for (const userId of userIds) {
		allowedUserIds.push(userId);
	}
}

/**
 * Centurion guard that checks whether the command executor is explicitly allowed by user ID or
 * belongs to the configured group with an authorized role.
 *
 * @param context - The command context, providing the executor and error reporting.
 * @returns `true` if the executor has an allowed user ID or role; otherwise `false` and an error is
 *   reported to the context.
 */
export function adminOrDeveloper(context: CommandContext): boolean {
	for (const allowedUserId of allowedUserIds) {
		if (context.executor.UserId === allowedUserId) {
			return true;
		}
	}

	const role = context.executor.GetRoleInGroup(groupId);
	for (const allowed of allowedRoles) {
		if (includes(role, allowed)) {
			return true;
		}
	}

	context.error(`Insufficient permissions for ${context.executor.Name} (${context.getData()})`);
	return false;
}

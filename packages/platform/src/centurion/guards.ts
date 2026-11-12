import type { CommandContext } from "@rbxts/centurion";

/**
 * Who may run an admin command.
 *
 * Both sides are stored case-folded, so a lookup is exact rather than a scan — build one with
 * {@link createAuthorizationPolicy} instead of constructing it by hand.
 */
export interface AuthorizationPolicy {
	/** Authorized role names, lower-cased. */
	readonly roles: ReadonlySet<string>;
	/** Authorized user IDs. */
	readonly userIds: ReadonlySet<number>;
}

/** What the caller observed about a command executor, independent of how it was observed. */
export interface AuthorizationInput {
	/** The executor's role in the configured group; `""` or absent for a non-member. */
	role?: string;
	/** The executor's Roblox user ID. */
	userId: number;
}

const defaultRoles: ReadonlyArray<string> = ["Developer", "Founder"];

/**
 * Normalizes a role list into the exact-match form the policy compares against.
 *
 * Folding happens once, here, so `authorize` never has to. A role is matched by full name, so
 * `Developer` admits `developer` but never `Junior Developer` — the distinction substring matching
 * lost, which let any `…Developer` rank through.
 *
 * @param roles - Role names as the operator configured them.
 * @param userIds - User IDs that bypass the role check.
 * @returns A policy whose role set is lower-cased and whose user IDs are exact.
 */
export function createAuthorizationPolicy(
	roles: ReadonlyArray<string>,
	userIds: ReadonlyArray<number>,
): AuthorizationPolicy {
	const folded = new Set<string>();
	for (const role of roles) {
		folded.add(string.lower(role));
	}

	return { roles: folded, userIds: new Set(userIds) };
}

/**
 * - Decides whether an executor may run an admin command.
 * - @param input - The executor's user ID and observed role.
 * - @param policy - The authoritative allowlist.
 * - @returns `true` when the user ID is listed, or the role is an exact member of the role set.
 * - @remarks Pure, so every rank string can be checked without a running Roblox instance. An empty
 *   policy denies: no configured role grants admin, which is the safe reading of "nobody is
 *   configured". The observed role is folded, so `Developer` and `developer` are the same rank
 *   while `Junior Developer` is a different one.
 */
export function authorize(input: AuthorizationInput, policy: AuthorizationPolicy): boolean {
	if (policy.userIds.has(input.userId)) {
		return true;
	}

	const {role} = input;
	if (role === undefined || role === "") {
		return false;
	}

	return policy.roles.has(string.lower(role));
}

let policy = createAuthorizationPolicy(defaultRoles, []);
let configuredRoles: ReadonlyArray<string> = defaultRoles;
let configuredUserIds: ReadonlyArray<number> = [];

/** Rebuilds the derived policy after a configuration change, so the fold happens once per change. */
function rebuildPolicy(): void {
	policy = createAuthorizationPolicy(configuredRoles, configuredUserIds);
}

/**
 * Configures the Roblox group ID used for centurion command authorization.
 *
 * @param id - The Roblox group ID to check roles against.
 */
let groupId = 0;
export function configureCenturionGroup(id: number): void {
	groupId = id;
}

/**
 * Configures which group roles are authorized to run admin commands. Default: `["Developer",
 * "Founder"]`. Matching is by full role name; configure `["Developer"]` and `Junior Developer` is
 * refused.
 *
 * @param roles - Role names to authorize. An empty list authorizes no role.
 */
export function configureCenturionRoles(roles: Array<string>): void {
	configuredRoles = [...roles];
	rebuildPolicy();
}

/**
 * Configures which Roblox user IDs are authorized to run admin commands.
 *
 * @param userIds - The Roblox user IDs that should bypass group-role checks.
 */
export function configureCenturionUsers(userIds: Array<number>): void {
	configuredUserIds = [...userIds];
	rebuildPolicy();
}

/**
 * Centurion guard that checks whether the command executor is explicitly allowed by user ID or
 * belongs to the configured group with an authorized role.
 *
 * @remarks
 *   New admin commands must use this guard (or {@link authorize} behind it) and must not hand-roll a
 *   role check. The role read is the synchronous `GetRoleInGroup`, because centurion's
 *   `CommandGuard` is typed `(context) => boolean`; see the follow-up issue about
 *   `GetRoleInGroupAsync` for the stale-role window that leaves.
 * @param context - The command context, providing the executor and error reporting.
 * @returns `true` if the executor has an allowed user ID or role; otherwise `false` and an error is
 *   reported to the context.
 */
export function adminOrDeveloper(context: CommandContext): boolean {
	const role = context.executor.GetRoleInGroup(groupId);
	if (authorize({ role, userId: context.executor.UserId }, policy)) {
		return true;
	}

	context.error(`Insufficient permissions for ${context.executor.Name} (${context.getData()})`);
	return false;
}

/*
 * zcode model/effort preflight.
 *
 * A model id that zcode's provider registry does not know surfaces only
 * mid-phase, as the fatal turn error 「Provider Registry 中不存在 Model」 —
 * after the worktree is prepared and the phase loop is already retrying.
 * This module validates the configured model id and reasoning effort
 * against the same provider configs the wrapper injects into the CLI
 * (`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`,
 * with the desktop-install and `~/.zcode` defaults), so a bad selection
 * fails fast with the available ids in the message.
 *
 * `account:*` providers need a second, credential-shaped check. Entitlement
 * itself is no obstacle: the wrapper now delivers the entitled account
 * snapshot over the protocol (`provider/updateAccountConfig`), replicating
 * what the desktop host does, and answers the per-model-attempt
 * `interaction/requestProviderRuntimeHeaders` request from the shared zcode
 * credential store. What *can* be checked up front is whether the credential
 * that answer needs exists: `start-plan` reads the `zcodejwttoken` entry
 * (falling back to `oauth:<accountType>:access_token`), and
 * `individual-coding-plan` reads a
 * `account-provider:coding-plan:<id>:account:<identity>:api-key` entry. A
 * missing credential surfaces only as a mid-turn -32031 error, so the
 * preflight names the missing key before dispatch. Key names only — store
 * values are encrypted and never inspected.
 *
 * Validation is deliberately conservative: anything that cannot be checked
 * (empty model, unreadable configs, unknown provider id) is skipped with a
 * note rather than blocked — the preflight exists to catch real
 * misconfigurations, never to invent reasons not to dispatch.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Reasoning levels zcode registers for glm/deepseek-class models. */
const ZCODE_EFFORT_LEVELS: ReadonlySet<string> = new Set(["high", "low", "max"]);

/** Raised when the configured model/effort cannot be valid for this zcode install. */
export class ZcodePreflightError extends Error {
	override name = "ZcodePreflightError";

	constructor(message: string) {
		super(message);
	}
}

/** `access` block of an `account:*` provider rule from a zcode provider config. */
export interface ZcodeAccountAccess {
	type?: string;
	accountType?: string;
	mode?: string;
}

/** One provider entry from a zcode provider config. */
interface ProviderRule {
	access?: unknown;
	config?: {
		builtinModelIds?: unknown;
		personalModelIds?: unknown;
	};
	enabled?: unknown;
	providerId?: unknown;
}

/**
 * - Resolve the shared credential store the standalone CLI reads
 *   (`<data-dir>/.zcode/v2/credentials.json`, honoring `ZCODE_DATA_BASE_DIR`, mirroring the CLI's
 *   own resolution).
 * - @param env - Environment supplying `ZCODE_DATA_BASE_DIR` (defaults to `process.env`).
 */
export function resolveZcodeCredentialStorePath(env: NodeJS.ProcessEnv = process.env): string {
	const baseDir = env.ZCODE_DATA_BASE_DIR?.trim() || homedir();
	return join(baseDir, ".zcode", "v2", "credentials.json");
}

/**
 * - Extract the `access` block of a provider rule when it is shape-valid.
 * - @returns The parsed access block, or undefined when absent/malformed.
 */
function parseAccountAccess(rule: ProviderRule): undefined | ZcodeAccountAccess {
	const access = [rule.access, (rule.config as undefined | { access?: unknown })?.access].find(
		(candidate): candidate is Record<string, unknown> =>
			typeof candidate === "object" && candidate !== null,
	);
	if (access === undefined) {
		return undefined;
	}

	const result: ZcodeAccountAccess = {};
	for (const key of ["accountType", "mode", "type"] as const) {
		const value = access[key];
		if (typeof value === "string") {
			result[key] = value;
		}
	}

	return result;
}

interface ProviderConfig {
	config?: {
		providerConfigRules?: {
			providerRules?: unknown;
			templateRules?: unknown;
		};
	};
}

/**
 * - Resolve the provider-config paths the preflight reads, mirroring the wrapper's
 *   `resolveProviderConfigEnv` (env overrides, then desktop-install defaults, then
 *   `~/.zcode/v2/provider_config.json`).
 * - @returns Existing file paths; entries without a file on disk are omitted.
 */
export function resolveZcodeProviderConfigPaths(): Array<string> {
	const paths: Array<string> = [];
	const builtinEnv = (process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ?? "").trim();
	if (builtinEnv !== "") {
		paths.push(builtinEnv);
	} else {
		paths.push(
			...(process.platform === "win32" && (process.env.LocalAppData ?? "") !== ""
				? [
						join(
							process.env.LocalAppData ?? "",
							"Programs",
							"ZCode",
							"resources",
							"config",
							"provider",
							"zcode-builtin.json",
						),
					]
				: process.platform === "darwin"
					? [
							"/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json",
						]
					: [
							"/opt/ZCode/resources/config/provider/zcode-builtin.json",
							"/usr/lib/zcode/resources/config/provider/zcode-builtin.json",
						]),
		);
	}

	const personalEnv = (process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE ?? "").trim();
	paths.push(
		personalEnv !== "" ? personalEnv : join(homedir(), ".zcode", "v2", "provider_config.json"),
	);

	return paths.filter((candidate) => existsSync(candidate));
}

function parseConfigFile(path: string): undefined | ProviderConfig {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as ProviderConfig;
	} catch {
		return undefined;
	}
}

function stringList(value: unknown): Array<string> {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

/**
 * - Build the model-id catalog from the resolved configs: a map of provider id → enabled model ids.
 *   Personal rules contribute `personalModelIds`, builtin template rules contribute
 *   `builtinModelIds`. Disabled providers are recorded so a disabled-provider selection can be
 *   rejected. Account-provider rules additionally contribute their `access` block so
 *   {@link assertZcodeAccountProviderServable} can judge headless servability.
 * - @param paths - Config files to read (existing paths only).
 * - @returns Catalog keyed by provider id, each provider's enabled flag, and account access blocks.
 */
export function buildZcodeModelCatalog(paths: Array<string>): {
	access: Map<string, ZcodeAccountAccess>;
	enabled: Map<string, boolean>;
	models: Map<string, Set<string>>;
} {
	const models = new Map<string, Set<string>>();
	const enabled = new Map<string, boolean>();
	const access = new Map<string, ZcodeAccountAccess>();

	const addModels = (key: string, ids: Array<string>, isEnabled: boolean): void => {
		const known = models.get(key);
		if (known !== undefined) {
			for (const id of ids) {
				known.add(id);
			}
		} else {
			models.set(key, new Set(ids));
			enabled.set(key, isEnabled);
		}
	};

	for (const path of paths) {
		const parsed = parseConfigFile(path);
		if (parsed === undefined) {
			continue;
		}

		const rules = parsed.config?.providerConfigRules ?? {};
		for (const rule of [rules.providerRules, rules.templateRules].flat()) {
			if (typeof rule !== "object" || rule === null) {
				continue;
			}

			const provider = rule as ProviderRule;
			const providerId =
				typeof provider.providerId === "string" ? provider.providerId : undefined;
			const isEnabled = provider.enabled !== false;
			const ids = [
				...stringList(provider.config?.personalModelIds),
				...stringList(provider.config?.builtinModelIds),
			];

			/*
			 * Template rules carry no providerId (the CLI assigns one on enable);
			 * their models are keyed by model id itself and are reachable through
			 * any enabled template instance.
			 */
			const key = providerId ?? modelIdKey(ids);
			addModels(key, ids, isEnabled);
			const accountAccess = parseAccountAccess(provider);
			if (accountAccess !== undefined && !access.has(key)) {
				access.set(key, accountAccess);
			}
		}
	}

	return { access, enabled, models };
}

/**
 * Template rules have no provider id, so their catalog key is the first model id they declare —
 * that is the key a later `providerId/modelId` lookup hits through the model-id fallback in
 * {@link assertZcodeModelSelectable}.
 */
function modelIdKey(ids: Array<string>): string {
	return ids[0] ?? "";
}

/**
 * - Judge whether the wrapper's runtime-header answer can source a credential for an `account:*`
 *   provider. The wrapper delivers entitlement itself (mirroring the desktop host), so the only
 *   headless blocker is a missing plan credential: `start-plan` reads `zcodejwttoken` (falling back
 *   to `oauth:<accountType>:access_token`), `individual-coding-plan` reads a
 *   `account-provider:coding-plan:<id>:account:<identity>:api-key` entry. Key names are read from
 *   the store's plaintext index only — values are encrypted and never inspected.
 * - @param providerId - Provider id half of the model selection (e.g. `account:zai-start-plan`).
 * - @param accessMap - Account access blocks collected by {@link buildZcodeModelCatalog}.
 * - @param credentialsPath - Credential store path; defaults to
 *   {@link resolveZcodeCredentialStorePath}.
 * - @throws {ZcodePreflightError} When the provider's plan credential is provably absent, or its plan
 *   mode is one the wrapper cannot answer (`team-coding-plan`, `off-peak`, `highspeed`).
 * - @remarks No-op for non-`account:` providers and for rules without a `zhipu-account` access block
 *   (personal api-key providers need no bootstrap).
 */
export function assertZcodeAccountProviderServable(
	providerId: string,
	accessMap: Map<string, ZcodeAccountAccess>,
	credentialsPath: string = resolveZcodeCredentialStorePath(),
): void {
	if (!providerId.startsWith("account:")) {
		return;
	}

	const access = accessMap.get(providerId);
	if (access === undefined || access.type !== "zhipu-account") {
		return; // Unknown or non-account rule: cannot judge, do not block.
	}

	if (access.mode !== "start-plan" && access.mode !== "individual-coding-plan") {
		throw new ZcodePreflightError(
			`zcode provider "${providerId}" declares plan mode "${access.mode ?? "unknown"}", which sandcastle's headless wrapper cannot serve (start-plan and individual-coding-plan are). Select a personal api-key provider id instead — see the provider list in the ZCode app.`,
		);
	}

	if (!existsSync(credentialsPath)) {
		throw new ZcodePreflightError(
			`zcode provider "${providerId}" has no plan credential: the zcode credential store (${credentialsPath}) does not exist. Connect the plan in the ZCode desktop app, then retry.`,
		);
	}

	let keys: Array<string> = [];
	try {
		const parsed: unknown = JSON.parse(readFileSync(credentialsPath, "utf-8"));
		if (typeof parsed === "object" && parsed !== null) {
			keys = Object.keys(parsed as Record<string, unknown>);
		}
	} catch {
		return; // Unreadable store: cannot judge, do not block.
	}

	if (access.mode === "start-plan") {
		const fallbackKey = `oauth:${access.accountType ?? "zai"}:access_token`;
		if (!keys.includes("zcodejwttoken") && !keys.includes(fallbackKey)) {
			throw new ZcodePreflightError(
				`zcode provider "${providerId}" has no plan credential ("zcodejwttoken" (or "${fallbackKey}") missing from ${credentialsPath}). Connect the Start Plan in the ZCode desktop app, then retry.`,
			);
		}

		return;
	}

	const codingPlanPrefix = `account-provider:coding-plan:${providerId}:account:`;
	if (!keys.some((key) => key.startsWith(codingPlanPrefix) && key.endsWith(":api-key"))) {
		throw new ZcodePreflightError(
			`zcode provider "${providerId}" has no plan credential ("${codingPlanPrefix}<identity>:api-key" missing from ${credentialsPath}). Connect the coding plan in the ZCode desktop app, then retry.`,
		);
	}
}

/**
 * - Validate a zcode model id and reasoning effort against the provider catalog.
 * - @param model - Full model id as sandcastle passes it, `providerId/modelId`.
 * - @param effort - Sandcastle effort after `resolveBackendEffort` mapping.
 * - @param paths - Config files to read; defaults to {@link resolveZcodeProviderConfigPaths}.
 * - @param credentialsPath - Credential store for the account-provider check; defaults to
 *   {@link resolveZcodeCredentialStorePath}.
 * - @throws {ZcodePreflightError} When the selection is provably invalid.
 * - @remarks Skips silently when the model is empty (backend default), no config file exists, the
 *   model string is malformed (the wrapper would run the default anyway), the provider id is
 *   unknown, or the provider is known but its model list is empty (nothing to check against). For
 *   `account:*` providers, also verifies the wrapper can source the plan credential its
 *   runtime-header answer needs (see {@link assertZcodeAccountProviderServable}).
 */
export function assertZcodeModelSelectable(
	model: string,
	effort: string,
	paths: Array<string> = resolveZcodeProviderConfigPaths(),
	credentialsPath: string = resolveZcodeCredentialStorePath(),
): void {
	const trimmed = model.trim();
	if (trimmed === "") {
		return; // No explicit model: the backend default applies.
	}

	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) {
		throw new ZcodePreflightError(
			`zcode model "${trimmed}" is malformed — expected "providerId/modelId" (e.g. "71fe3b98-…/th/glm-5.3-flash"). The wrapper would silently run the default model.`,
		);
	}

	if (paths.length === 0) {
		return; // No configs on disk: cannot validate, do not block.
	}

	const { access, enabled, models } = buildZcodeModelCatalog(paths);
	const providerId = trimmed.slice(0, slash);
	const modelId = trimmed.slice(slash + 1);

	const knownIds = models.get(providerId) ?? models.get(modelId);
	if (knownIds === undefined) {
		console.warn(
			`  ⚠ zcode preflight: provider "${providerId}" not found in ${String(paths.length)} provider config(s); skipping model validation.`,
		);
		return;
	}

	if (enabled.get(providerId) === false) {
		throw new ZcodePreflightError(
			`zcode provider "${providerId}" is disabled in the provider config — enable it in the ZCode app (or ~/.zcode/v2/provider_config.json).`,
		);
	}

	assertZcodeAccountProviderServable(providerId, access, credentialsPath);

	if (knownIds.size > 0 && !knownIds.has(modelId)) {
		const available = [...knownIds].sort().join(", ");
		throw new ZcodePreflightError(
			`zcode model "${modelId}" is not registered under provider "${providerId}". Available: ${available}`,
		);
	}

	const resolvedEffort = effort.trim();
	if (resolvedEffort !== "" && !ZCODE_EFFORT_LEVELS.has(resolvedEffort) && knownIds.size > 0) {
		throw new ZcodePreflightError(
			`zcode reasoning effort "${resolvedEffort}" is not one of ${[...ZCODE_EFFORT_LEVELS].sort().join(", ")}.`,
		);
	}
}

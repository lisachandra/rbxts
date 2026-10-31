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

/** One provider entry from a zcode provider config. */
interface ProviderRule {
	config?: {
		builtinModelIds?: unknown;
		personalModelIds?: unknown;
	};
	enabled?: unknown;
	providerId?: unknown;
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
 *   rejected.
 * - @param paths - Config files to read (existing paths only).
 * - @returns Catalog keyed by provider id, and each provider's enabled flag.
 */
export function buildZcodeModelCatalog(paths: Array<string>): {
	enabled: Map<string, boolean>;
	models: Map<string, Set<string>>;
} {
	const models = new Map<string, Set<string>>();
	const enabled = new Map<string, boolean>();

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
			addModels(providerId ?? modelIdKey(ids), ids, isEnabled);
		}
	}

	return { enabled, models };
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
 * - Validate a zcode model id and reasoning effort against the provider catalog.
 * - @param model - Full model id as sandcastle passes it, `providerId/modelId`.
 * - @param effort - Sandcastle effort after `resolveBackendEffort` mapping.
 * - @param paths - Config files to read; defaults to {@link resolveZcodeProviderConfigPaths}.
 * - @throws {ZcodePreflightError} When the selection is provably invalid.
 * - @remarks Skips silently when the model is empty (backend default), no config file exists, the
 *   model string is malformed (the wrapper would run the default anyway), the provider id is
 *   unknown, or the provider is known but its model list is empty (nothing to check against).
 */
export function assertZcodeModelSelectable(
	model: string,
	effort: string,
	paths: Array<string> = resolveZcodeProviderConfigPaths(),
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

	const { enabled, models } = buildZcodeModelCatalog(paths);
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

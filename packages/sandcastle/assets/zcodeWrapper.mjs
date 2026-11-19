#!/usr/bin/env node
/*
 * Sandcastle zcode wrapper.
 *
 * Bridges the ZCode Protocol (`zcode app-server`, newline-delimited JSON over
 * stdio) to the flat JSONL event stream @ai-hero/sandcastle expects from a
 * provider. The prompt arrives on stdin; flags after argv control the session:
 *
 *   --mode <mode>              permission mode: yolo (default) or build
 *   --model <providerId/modelId>  model selection; omitted uses zcode's default
 *   --reasoning-effort <level> thought level; forwarded per-session
 *   --resume-session <id>      resume a persisted session instead of creating one
 *
 * Binary resolution order: $ZCODE_SANDCASTLE_BIN, `zcode` on PATH, then the
 * ZCode desktop app's bundled CLI. Outside the desktop app the CLI cannot
 * locate its built-in provider catalog, so the wrapper injects
 * ZCODE_BUILTIN_PROVIDER_CONFIG_FILE (plus ZCODE_PERSONAL_PROVIDER_CONFIG_FILE
 * when resolvable) before spawning; preset values pass through untouched.
 *
 * Plan-mode account providers (`account:zai-start-plan/*` et al) are gated by
 * entitlement that is host-supplied protocol state, not config: the desktop
 * app pushes an entitled account snapshot to the app-server and answers a
 * runtime-header request before each model call. The wrapper plays that host
 * role headless — it delivers `provider/updateAccountConfig` for the selected
 * provider (keyed to the injected builtin catalog's revision) and answers
 * `interaction/requestProviderRuntimeHeaders` from the shared zcode
 * credential store, the way the desktop host does. The store's on-disk format
 * changed in zcode 3.18: records are now `enc:v2:<os|env>:<fingerprint>:`
 * under an OS-keyring or managed secret (see the credential-store block
 * below), and both schemes are read. The identity headers carry
 * the desktop app's version even when `ZCODE_APP_VERSION` is unset in the
 * runner environment: the newest runtime dir under
 * `.zcode/v2/runtime/provider/<platform>-<arch>/` names the version the
 * desktop currently runs, and the gateway rejects `ZCode/unknown` agents with
 * the same 3012 as header-less requests.
 * Events are emitted as one JSON object per line:
 * {type:"text"|"tool"|"note"|"result"|"usage"|"keepalive"}. In
 * desktop-continuous delivery the app-server streams model.streaming deltas
 * (text_delta / tool_input_*) and tool.updated lifecycle events
 * (scheduled/started/progress/result) — the result kind carries the command,
 * exit code and output preview, which the wrapper folds into the tool
 * event's `detail` for digest parity with dirac's cards. The final
 * turn.completed response becomes the single `result` event. Unknown lines
 * (non-JSON, stderr noise) are ignored by the provider's parser.
 *
 * Keep-alive heartbeats: upstream's idle watchdog (600s default) is reset by
 * any stdout line, so the wrapper emits {type:"keep-alive"} while the model
 * streams. The heartbeat is re-armed ONLY by stdout-producing events —
 * reasoning deltas are dropped from stdout, and letting them re-arm the timer
 * silenced the heartbeat for entire thinking stretches (glm at high effort
 * thinks > 10 min), starving upstream into AgentIdleTimeoutError mid-thought.
 * Cadence: ZCODE_SANDCASTLE_HEARTBEAT_MS (default 120000, min 100).
 *
 * Subagents: by default the app-server loads agent definitions from the local
 * user/worktree `.zcode/agents` dirs, so sandcastle agents could spawn
 * subagents. Set ZCODE_SANDCASTLE_DISABLE_SUBAGENTS=1 to opt out: the wrapper
 * advertises `subagentRuntimeConfigEnabled` and answers
 * `subagents/readRuntimeConfig` with `built-in-fallback`, leaving the session
 * with zero subagent types (no runtime profiles, and plugin agent definitions
 * are skipped too).
 */

import { createDecipheriv, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import {
	arch as osArch,
	homedir,
	platform as osPlatform,
	release as osRelease,
	userInfo,
} from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const DELIVERY_KIND = "desktop-continuous";
/*
 * Opt out of subagent spawning. Without this the app-server loads agent
 * definitions from ~/.zcode/agents and the worktree's .zcode/agents, so the
 * agent has subagent types to spawn. With it, the wrapper advertises
 * subagentRuntimeConfigEnabled (definitions come from the wrapper instead of
 * local disks) and answers subagents/readRuntimeConfig with built-in-fallback
 * — zero profiles, and the caller skips plugin agent definitions too.
 */
const SUBAGENTS_DISABLED = process.env.ZCODE_SANDCASTLE_DISABLE_SUBAGENTS === "1";

const RUNTIME_PREFERENCES = {
	askUserQuestionAutoResolutionEnabled: true,
	memoryEnabled: false,
	modelContextBudgetStrategy: "preflight-v1",
	nativeSearchEnhancementsEnabled: false,
	// Host-delivered definitions (or none) instead of scanning local disks.
	...(SUBAGENTS_DISABLED ? { subagentRuntimeConfigEnabled: true } : {}),
};
const REQUEST_TIMEOUT_MS = 60_000;
/*
 * Heartbeat cadence while the model streams. Only stdout-producing events may
 * re-arm this timer (see markActivity): reasoning deltas are deliberately
 * dropped from stdout, and a long pure-thinking stretch (glm at high effort
 * thinks > 10 minutes) must still emit keep-alives or upstream's 600 s idle
 * watchdog kills the phase with AgentIdleTimeoutError — the exact failure on
 * rocket-powered-blox-cars #174 (32 min of thinking, zero stdout lines).
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = (() => {
	const preset = Number.parseInt(process.env.ZCODE_SANDCASTLE_HEARTBEAT_MS ?? "", 10);
	if (Number.isFinite(preset) && preset >= 100) {
		return preset;
	}

	return DEFAULT_HEARTBEAT_INTERVAL_MS;
})();

/*
 * Credential-store access for answering provider runtime-header requests.
 *
 * The store is the same file the desktop app and the CLI write
 * (<data-dir>/.zcode/v2/credentials.json). Two record schemes exist, and zcode
 * migrates every entry to the newer one on the first run after the change:
 *
 *   enc:v1:<base64url(iv)>.<base64url(tag)>.<base64url(ct)>
 *       AES-256-GCM under a key derived from the machine identity, so any
 *       process running as the same OS user can decrypt it.
 *
 *   enc:v2:<os|env>:<keyFingerprint>:<base64url(iv)>.<base64url(tag)>.<base64url(ct)>
 *       AES-256-GCM under a 32-byte random key held in the OS keyring
 *       (service "ZCode Credential Encryption", account = sha256 of the
 *       resolved store path), or -- for headless servers -- under a managed
 *       secret (ZCODE_CREDENTIAL_SECRET, else a 32..4096-byte private
 *       credential-secret file beside the store). The embedded scheme and key
 *       fingerprint are exactly what the CLI validates before decrypting.
 *
 * zcode 3.18 migrated this machine's store to v2, and a wrapper that only
 * understood enc:v1: passed the *ciphertext* through as the api key -- the
 * plan gateway answered 401 and the matchmaking-session-work lane died on
 * #645. Both schemes are therefore supported here, and a record that cannot
 * be decrypted is reported by KEY NAME only: it is never handed to the
 * gateway as if it were a credential.
 *
 * The wrapper holds decrypted values only in memory, only for the single
 * credential a model request needs, and never logs them: diagnostics name
 * credential *keys*, never values.
 */
const CREDENTIAL_ENC_V1_PREFIX = "enc:v1:";
const CREDENTIAL_ENC_V2_PREFIX = "enc:v2:";
/** Keyring service name the CLI and desktop use for the v2 key. */
const CREDENTIAL_KEYRING_SERVICE = "ZCode Credential Encryption";
/** Length of the hex key fingerprint embedded in a v2 record. */
const CREDENTIAL_KEY_FINGERPRINT_LENGTH = 24;
/** The v2 key is 32 random bytes, stored base64url in the keyring. */
const CREDENTIAL_KEY_LENGTH = 32;
/** ...which is 43 base64url characters, the CLI's accepted keyring shape. */
const CREDENTIAL_KEYRING_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function resolveCredentialStorePath() {
	const baseDir = (process.env.ZCODE_DATA_BASE_DIR ?? "").trim() || homedir();
	return path.join(baseDir, ".zcode", "v2", "credentials.json");
}

function safeUserName() {
	try {
		return userInfo().username;
	} catch {
		return "unknown";
	}
}

/**
 * - The v1 key candidates, in the CLI's own precedence order.
 * - @remarks Untrimmed secret, then trimmed secret, then the machine fallback -- exactly the three
 *   derivations the CLI tries before it gives up on a legacy record.
 */
function legacyCredentialKeys() {
	const fallback = `zcode-credential-fallback:${osPlatform()}:${homedir()}:${safeUserName()}`;
	const raw = process.env.ZCODE_CREDENTIAL_SECRET;
	const trimmed = raw?.trim() ?? "";
	return [...new Set([raw || fallback, trimmed || fallback, fallback])].map((value) =>
		createHash("sha256").update(value).digest(),
	);
}

/** Hex fingerprint of a v2 key -- the CLI embeds sha256(key).hex.slice(0, 24). */
function credentialKeyFingerprint(key) {
	return createHash("sha256")
		.update(key)
		.digest("hex")
		.slice(0, CREDENTIAL_KEY_FINGERPRINT_LENGTH);
}

/**
 * - Resolves the managed secret a v2 "env" record is encrypted under.
 * - @returns The secret, or undefined when none is configured or the configuration is ambiguous in
 *   the way the CLI itself refuses.
 * - @remarks Mirrors the CLI: the env var and the secret file may not both be set, and a
 *   _default-path_ secret file must be private on POSIX (an explicitly named one is the caller's
 *   business). Size is 32..4096 bytes, as used as-is -- never trimmed, because the CLI hashes the
 *   file contents verbatim.
 */
function resolveManagedCredentialSecret() {
	const preset = process.env.ZCODE_CREDENTIAL_SECRET;
	const filePath = (process.env.ZCODE_CREDENTIAL_SECRET_FILE ?? "").trim();
	if (preset !== undefined && preset !== "" && filePath !== "") {
		return undefined;
	}

	if (preset !== undefined && preset !== "") {
		return preset;
	}

	const explicit = filePath !== "";
	const candidate = explicit
		? filePath
		: path.join(path.dirname(resolveCredentialStorePath()), "credential-secret");
	try {
		if (!explicit && process.platform !== "win32") {
			const mode = statSync(candidate).mode;
			if ((mode & 0o077) !== 0) {
				// Group/world access on a default secret file: treat as unavailable.
				return undefined;
			}
		}

		const contents = readFileSync(candidate, "utf8");
		const bytes = Buffer.byteLength(contents, "utf8");
		if (bytes >= 32 && bytes <= 4096) {
			return contents;
		}
	} catch {
		// Missing or unreadable: no managed secret.
	}

	return undefined;
}

let keyringModuleCache;

/** Locates the @napi-rs/keyring binding inside the installed ZCode desktop app. */
function importKeyringModule() {
	if (keyringModuleCache !== undefined) {
		return keyringModuleCache;
	}

	const isWindows = process.platform === "win32";
	const localAppData = process.env.LocalAppData ?? "";
	const resourceRoots =
		isWindows && localAppData !== ""
			? [path.join(localAppData, "Programs", "ZCode", "resources")]
			: process.platform === "darwin"
				? ["/Applications/ZCode.app/Contents/Resources"]
				: ["/opt/ZCode/resources", "/usr/lib/zcode/resources"];
	for (const resourceRoot of resourceRoots) {
		const scopeRoot = path.join(resourceRoot, "app.asar.unpacked", "node_modules", "@napi-rs");
		if (!existsSync(scopeRoot)) {
			continue;
		}

		for (const dir of readdirSync(scopeRoot)) {
			if (!dir.startsWith("keyring-")) {
				continue;
			}

			const directory = path.join(scopeRoot, dir);
			for (const file of readdirSync(directory)) {
				if (!file.endsWith(".node")) {
					continue;
				}

				try {
					keyringModuleCache = createRequire(import.meta.url)(path.join(directory, file));
					return keyringModuleCache;
				} catch {
					// Try the next platform binding.
				}
			}
		}
	}

	return undefined;
}

/**
 * - Reads the v2 OS-keyring key the CLI and desktop store.
 * - @returns The 32-byte key, or undefined when the keyring is unavailable.
 * - @remarks The native binding ships with the ZCode desktop app, which is also the only situation in
 *   which an "os" record can exist.
 */
function readKeyringCredentialKey() {
	let native;
	try {
		native = importKeyringModule();
	} catch {
		return undefined;
	}

	if (native === undefined) {
		return undefined;
	}

	const account = createHash("sha256")
		.update(path.resolve(resolveCredentialStorePath()))
		.digest("hex");
	try {
		const entry = new native.Entry(CREDENTIAL_KEYRING_SERVICE, account);
		const stored = entry.getPassword();
		/* The CLI's own shape check: 32 bytes rendered base64url, unpadded. */
		if (typeof stored !== "string" || !CREDENTIAL_KEYRING_PASSWORD_PATTERN.test(stored)) {
			return undefined;
		}

		const key = Buffer.from(stored, "base64url");
		return key.length === CREDENTIAL_KEY_LENGTH ? key : undefined;
	} catch {
		return undefined;
	}
}

/** AES-256-GCM open of base64url(iv).base64url(tag).base64url(ct). */
function openCredentialRecord(payload, key) {
	const parts = payload.split(".");
	if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part))) {
		throw new Error("malformed encrypted credential");
	}

	const [iv, tag, data] = parts.map((part) => Buffer.from(part, "base64url"));
	if (iv.length !== 12 || tag.length !== 16) {
		throw new Error("malformed encrypted credential");
	}

	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}

/**
 * - Decrypts one store value, accepting both record schemes.
 * - @param value - The raw store value.
 * - @param v2Keys - Per-scheme v2 key cache, resolved at most once per run.
 * - @returns The plaintext, or undefined when the record cannot be opened.
 */
function decryptCredentialValue(value, v2Keys) {
	if (value.startsWith(CREDENTIAL_ENC_V1_PREFIX)) {
		const payload = value.slice(CREDENTIAL_ENC_V1_PREFIX.length);
		for (const key of legacyCredentialKeys()) {
			try {
				return openCredentialRecord(payload, key);
			} catch {
				// Try the next v1 derivation.
			}
		}

		return undefined;
	}

	if (!value.startsWith(CREDENTIAL_ENC_V2_PREFIX)) {
		return value;
	}

	/* Exactly [scheme, fingerprint, payload] -- the shape the CLI enforces. */
	const segments = value.slice(CREDENTIAL_ENC_V2_PREFIX.length).split(":");
	const [scheme, fingerprint, payload] = segments;
	if (
		segments.length !== 3 ||
		(scheme !== "os" && scheme !== "env") ||
		fingerprint === undefined ||
		!/^[a-f0-9]{24}$/.test(fingerprint) ||
		payload === undefined
	) {
		return undefined;
	}

	if (v2Keys[scheme] === undefined) {
		v2Keys[scheme] =
			scheme === "os"
				? readKeyringCredentialKey()
				: (() => {
						const secret = resolveManagedCredentialSecret();
						return secret === undefined
							? undefined
							: createHash("sha256").update(secret).digest();
					})();
	}

	const key = v2Keys[scheme];
	if (key === undefined) {
		return undefined;
	}

	/* The CLI refuses a record whose embedded fingerprint is not this key's. */
	if (credentialKeyFingerprint(key) !== fingerprint) {
		return undefined;
	}

	try {
		return openCredentialRecord(payload, key);
	} catch {
		return undefined;
	}
}

let credentialStoreCache;
function loadCredentialStore() {
	if (credentialStoreCache !== undefined) {
		return credentialStoreCache;
	}

	const store = new Map();
	const storePath = resolveCredentialStorePath();
	if (!existsSync(storePath)) {
		return store;
	}

	const v2Keys = {};
	const undecryptable = [];
	try {
		const parsed = JSON.parse(readFileSync(storePath, "utf-8"));
		if (parsed !== null && typeof parsed === "object") {
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value !== "string") {
					continue;
				}

				const plaintext = decryptCredentialValue(value, v2Keys);
				if (plaintext === undefined) {
					undecryptable.push(key);
					continue;
				}

				store.set(key, plaintext);
			}
		}
	} catch (error) {
		emitNote(`credential store at ${storePath} unreadable: ${error.message}`);
	}

	if (undecryptable.length > 0) {
		/*
		 * Keys only: a skipped record must never reach the gateway as an api
		 * key, and the store's values are never printed.
		 */
		const shown = undecryptable.slice(0, 3).join(", ");
		emitNote(
			`could not decrypt ${undecryptable.length} credential entr(ies) (${shown}${undecryptable.length > 3 ? ", ..." : ""}); ` +
				"run zcode once as this OS user so the credential key is available",
		);
	}

	return store;
}

function parseArgs(argv) {
	const args = { effort: "", mode: "yolo", model: "", resumeSession: "" };
	for (let index = 0; index < argv.length; index++) {
		const value = argv[index + 1] ?? "";
		if (value === "") {
			continue;
		}

		switch (argv[index]) {
			case "--mode": {
				args.mode = value;
				index++;

				break;
			}
			case "--model": {
				args.model = value;
				index++;

				break;
			}
			case "--reasoning-effort": {
				args.effort = value;
				index++;

				break;
			}
			case "--resume-session": {
				args.resumeSession = value;
				index++;

				break;
			}
			// No default
		}
	}

	return args;
}

function resolveBinary() {
	const override = process.env.ZCODE_SANDCASTLE_BIN?.trim();
	if (override !== undefined && override !== "" && existsSync(override)) {
		return override;
	}

	const isWindows = process.platform === "win32";
	const extensions = isWindows ? [".exe", ".cjs", ".cmd", ""] : [""];
	for (const dir of (process.env.PATH ?? "").split(isWindows ? ";" : ":")) {
		if (dir === "") {
			continue;
		}

		for (const extension of extensions) {
			const candidate = `${dir}${isWindows ? "\\" : "/"}zcode${extension}`;
			if (existsSync(candidate)) {
				return candidate;
			}
		}
	}

	const localAppData = process.env.LocalAppData ?? "";
	const candidates =
		isWindows && localAppData !== ""
			? [`${localAppData}\\Programs\\ZCode\\resources\\glm\\zcode.cjs`]
			: process.platform === "darwin"
				? ["/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"]
				: ["/opt/ZCode/resources/glm/zcode.cjs", "/usr/lib/zcode/resources/glm/zcode.cjs"];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

/*
 * ZCode's bundled CLI resolves its built-in provider catalog relative to its
 * own entrypoint (entry_dir/provider/zcode-builtin.json, then entry_dir/../
 * config/provider/zcode-builtin.json) and aborts at startup when neither
 * exists — the ZCode desktop app normally injects these paths via env, which
 * is why running `zcode app-server` from a bare shell fails. Mirror the
 * desktop app here: use preset env values when set, otherwise fall back to
 * the desktop install's packaged catalog and ~/.zcode/v2/provider_config.json.
 */
function findPackagedBuiltinConfig() {
	const isWindows = process.platform === "win32";
	const localAppData = process.env.LocalAppData ?? "";
	const candidates =
		isWindows && localAppData !== ""
			? [path.join(localAppData, "Programs", "ZCode", "resources", "config", "provider")]
			: process.platform === "darwin"
				? ["/Applications/ZCode.app/Contents/Resources/config/provider"]
				: [
						"/opt/ZCode/resources/config/provider",
						"/usr/lib/zcode/resources/config/provider",
					];
	for (const directory of candidates) {
		const candidate = path.join(directory, "zcode-builtin.json");
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

function resolveEffectiveBuiltinConfigPath() {
	const envPath = (process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ?? "").trim();
	if (envPath !== "") {
		return envPath;
	}

	return findPackagedBuiltinConfig();
}
function resolveProviderConfigEnv() {
	const env = {};
	const builtinKey = "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE";
	const personalKey = "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE";
	const envPath = (key) => (process.env[key] ?? "").trim();
	const builtinPreset = envPath(builtinKey) !== "";
	const personalPreset = envPath(personalKey) !== "";
	if (builtinPreset && personalPreset) {
		return env; // The CLI resolves everything from env; nothing to inject.
	}

	if (!builtinPreset) {
		const packaged = findPackagedBuiltinConfig();
		if (packaged === undefined) {
			emitNoteOnce(
				"ZCODE_BUILTIN_PROVIDER_CONFIG_FILE unset and no desktop install found; " +
					"relying on zcode's own lookup",
			);
			return env;
		}

		env[builtinKey] = packaged;
	}

	if (!personalPreset) {
		const personal = path.join(homedir(), ".zcode", "v2", "provider_config.json");
		if (existsSync(personal)) {
			env[personalKey] = personal;
		}
	}

	return env;
}

/*
 * Notes that are worth saying once per run, latched per call site rather than globally.
 *
 * A single flag muted every note after the first one, and on a host without the desktop app
 * resolveProviderConfigEnv takes that first slot unconditionally — so the note a resumed phase
 * prints when its model cannot honour the requested reasoning level was silently dropped, and an
 * operator saw a phase quietly keep an old level with no explanation. The latch keys on the message
 * so the guarantee stays "this same note is not repeated": repeated setup notes collapse, distinct
 * ones all survive.
 */
const emittedNotes = new Set();
function emitNoteOnce(message) {
	if (emittedNotes.has(message)) {
		return;
	}

	emittedNotes.add(message);
	emitNote(message);
}

/*
 * Zcode gives up on a model request after 10 retries (~11 attempts, capped
 * 2s..60s backoff). A flaky provider endpoint (HTTP 5xx, connection resets)
 * then fails the whole sandcastle phase. Retry effectively forever unless the
 * caller preset ZCODE_MODEL_RETRY_MAX_RETRIES: at the 60s backoff cap the
 * budget spans years, and zcode still honors Retry-After for rate limits.
 */
const DEFAULT_RETRY_BUDGET = "100000";
function resolveRetryEnv() {
	const key = "ZCODE_MODEL_RETRY_MAX_RETRIES";
	const preset = (process.env[key] ?? "").trim();
	if (preset !== "") {
		return {};
	}

	emitNote(`injecting ${key}=${DEFAULT_RETRY_BUDGET} (set the env to override)`);
	return { [key]: DEFAULT_RETRY_BUDGET };
}

/*
 * Plan-mode account providers are executable only after the host delivers an
 * entitled account snapshot over the protocol (the desktop app does this
 * whenever it connects). Replicate that here: derive the snapshot for the
 * selected provider from the same builtin catalog the CLI is about to load,
 * keyed to its revision string 'zcode-builtin:<n>:<sha256(abs path)>' — the
 * registry discards a snapshot whose basedOn revision does not match.
 */
function buildAccountDelivery(providerId) {
	const builtinPath = resolveEffectiveBuiltinConfigPath();
	if (builtinPath === undefined) {
		emitNoteOnce(
			"cannot deliver account provider config: no builtin catalog found; " +
				"account providers will fail session/create as before",
		);
		return undefined;
	}

	let catalog;
	try {
		catalog = JSON.parse(readFileSync(builtinPath, "utf-8"));
	} catch (error) {
		emitNoteOnce(
			`cannot deliver account provider config: builtin catalog unreadable: ${error.message}`,
		);
		return undefined;
	}

	const rules = catalog?.config?.providerConfigRules?.providerRules;
	const rule = Array.isArray(rules)
		? rules.find((entry) => entry?.providerId === providerId)
		: undefined;
	const access = rule?.config?.access;
	if (access?.type !== "zhipu-account") {
		emitNoteOnce(
			`cannot deliver account provider config: "${providerId}" is not a zhipu-account builtin rule`,
		);
		return undefined;
	}

	const revision = `account:sandcastle-${process.pid}-${Date.now()}`;
	return {
		revision,
		basedOnZCodeBuiltinRevision: `zcode-builtin:${catalog.revision}:${createHash("sha256")
			.update(path.resolve(builtinPath))
			.digest("hex")}`,
		providers: {
			[providerId]: {
				builtinModelIds: rule.config.builtinModelIds,
				access: { type: "zhipu-account", entitled: true },
			},
		},
		states: {
			[providerId]: { availability: "available", entitled: true, current: true },
		},
	};
}

/** Delivers the entitled snapshot so plan-mode models resolve; best-effort. */
async function deliverAccountProviderConfig(providerId) {
	const snapshot = buildAccountDelivery(providerId);
	if (snapshot === undefined) {
		return;
	}

	try {
		const ack = await request("provider/updateAccountConfig", snapshot, 30_000);
		emitNote(
			`account provider config delivered for ${providerId} (status ${ack?.status ?? "unknown"})`,
		);
	} catch (error) {
		emitNoteOnce(
			`account provider config delivery failed (${error.message}); continuing — ${providerId} may fail session/create`,
		);
	}
}
function spawnServer(binary) {
	const isWindows = process.platform === "win32";
	const isScript = /\.(cjs|mjs|js)$/i.test(binary);
	const isShellShim = isWindows && /\.cmd$/i.test(binary);
	const childEnv = { ...process.env, ...resolveProviderConfigEnv(), ...resolveRetryEnv() };
	if (isScript) {
		return spawn(process.execPath, [binary, "app-server"], {
			env: childEnv,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	if (isShellShim) {
		return spawn("cmd.exe", ["/c", binary, "app-server"], {
			env: childEnv,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	return spawn(binary, ["app-server"], {
		env: childEnv,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function emit(event) {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

/*
 * Stdout/stderr pipes are async in Node: a write queued right before
 * process.exit() can be dropped. Every diagnostic below rides on stderr
 * (agent-wrapper.sh merges it into stdout), so failing paths flush it before
 * exiting or the real error never reaches the runner's error detail.
 */
function writeFlushed(stream, text) {
	return new Promise((resolve) => {
		if (stream.write(text, () => resolve())) {
			resolve();
		}
	});
}

function emitNote(message) {
	process.stderr.write(`zcode-wrapper: ${message}\n`);
}

const args = parseArgs(process.argv.slice(2));
const binary = resolveBinary();
if (binary === undefined) {
	void writeFlushed(
		process.stderr,
		"zcode-wrapper: zcode binary not found. Set ZCODE_SANDCASTLE_BIN to the CLI entry " +
			"(e.g. the desktop bundle zcode.cjs), install zcode on PATH, or install the ZCode desktop app.\n",
	).then(() => process.exit(1));
}

const child = spawnServer(binary);
const stderrTail = [];
child.stderr.on("data", (chunk) => {
	stderrTail.push(String(chunk));
	if (stderrTail.length > 32) {
		stderrTail.shift();
	}
});
child.on("exit", (code, signal) => {
	if (!finished) {
		finished = true;
		void (async () => {
			await writeFlushed(
				process.stderr,
				`zcode-wrapper: zcode app-server exited early (code=${code ?? "null"} signal=${signal ?? "null"})\n`,
			);
			await dumpStderrTail();
			process.exit(1);
		})();
	}
});

/** Dump the buffered app-server stderr to the wrapper's stderr, flushed. */
async function dumpStderrTail() {
	const tail = stderrTail.join("").trim();
	if (tail !== "") {
		await writeFlushed(
			process.stderr,
			`zcode-wrapper: --- zcode stderr (last ${stderrTail.length} chunks) ---\n${tail.slice(-8_000)}\n`,
		);
	}
}

let nextRequestId = 0;
const pendingRequests = new Map();
function writeFrame(frame) {
	child.stdin.write(`${JSON.stringify(frame)}\n`);
}

function respond(id, result) {
	writeFrame({ id, result });
}

function request(method, parameters, timeoutMs = REQUEST_TIMEOUT_MS) {
	const id = ++nextRequestId;
	writeFrame({ id, method, params: parameters });
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`zcode request timed out after ${timeoutMs}ms: ${method}`));
		}, timeoutMs);
		pendingRequests.set(id, {
			method,
			reject: (error) => {
				clearTimeout(timer);
				reject(error);
			},
			resolve: (value) => {
				clearTimeout(timer);
				resolve(value);
			},
		});
	});
}

async function handleServerRequest(frame) {
	const { id, method, params } = frame;
	if (method === "session/requestRuntimePreferences") {
		respond(id, RUNTIME_PREFERENCES);
		return;
	}

	if (method === "interaction/requestOfficialMcpAuthHeaders") {
		respond(id, { error: { code: -32601, message: "Unsupported" } });
		return;
	}

	if (method === "interaction/requestPermission") {
		const options = Array.isArray(params?.options) ? params.options : [];
		const allow = options.find((option) => option?.response?.decision === "allow");
		const note =
			`auto-answered permission for ${params?.toolName ?? "unknown tool"} ` +
			`(risk ${params?.riskLevel ?? "?"})`;
		emitNote(note);
		emit({ type: "note", text: note });
		respond(
			id,
			allow?.response ?? {
				decision: "deny",
				reason: "zcode-wrapper: no allow option offered",
			},
		);
		return;
	}

	if (method === "interaction/requestUserInput") {
		const note = "auto-cancelled user input request (headless run)";
		emitNote(note);
		emit({ type: "note", text: note });
		respond(id, { cancelled: true, value: "" });
		return;
	}

	if (method === "interaction/requestProviderRuntimeHeaders") {
		respond(id, await resolveProviderRuntimeHeaders(params));
		return;
	}

	if (method === "subagents/readRuntimeConfig") {
		/*
		 * The SUBAGENTS_DISABLED preference above makes the app-server request
		 * agent definitions from the wrapper; built-in-fallback hands back none
		 * (empty profiles, and the caller skips plugin agent definitions), so
		 * the session has no subagent types at all.
		 */
		respond(id, SUBAGENTS_DISABLED ? { kind: "built-in-fallback" } : {});
		return;
	}

	respond(id, {});
}

/*
 * Answers the per-model-attempt auth request the way the desktop host does:
 * the apiKey lands on the transport itself (anthropic-messages → x-api-key).
 * A non-applied response surfaces as the turn error -32031 with our message,
 * which is the actionable path for a missing plan credential.
 */
async function resolveProviderRuntimeHeaders(params) {
	const accountAccess = params?.accountAccess;
	const providerId = String(params?.providerId ?? "unknown provider");
	if (accountAccess?.type !== "zhipu-account") {
		return {
			headersApplied: false,
			errorMessage:
				`zcode-wrapper: no zhipu-account access on the runtime-header request for ${providerId}; ` +
				"the wrapper only serves plan-mode account providers",
		};
	}

	if (accountAccess.mode === "start-plan") {
		// The desktop answers start-plan with the zcode JWT from the OAuth token set.
		const store = await loadCredentialStore();
		const apiKey = store.get("zcodejwttoken") ?? store.get("oauth:zai:access_token");
		return finalizeRuntimeHeaders(
			apiKey,
			providerId,
			"zcodejwttoken (or oauth:zai:access_token)",
		);
	}

	if (accountAccess.mode === "individual-coding-plan") {
		// Standalone login persists a per-provider api-key keyed by account identity.
		const prefix = `account-provider:coding-plan:${providerId}:account:`;
		const entry = [...(await loadCredentialStore()).entries()].find(
			([key]) => key.startsWith(prefix) && key.endsWith(":api-key"),
		);
		return finalizeRuntimeHeaders(
			entry?.[1],
			providerId,
			entry?.[0] ?? `${prefix}<identity>:api-key`,
		);
	}

	return {
		headersApplied: false,
		errorMessage:
			`zcode-wrapper: plan mode "${accountAccess.mode}" is not supported by sandcastle's ` +
			"headless wrapper (start-plan and individual-coding-plan are)",
	};
}

function finalizeRuntimeHeaders(apiKey, providerId, credentialKey) {
	if (apiKey === undefined || apiKey.trim() === "") {
		return {
			headersApplied: false,
			errorMessage:
				`zcode-wrapper: no plan credential for ${providerId} (expected ${credentialKey} in ` +
				"the zcode credential store) — connect the plan in the ZCode desktop app first",
		};
	}

	return { headersApplied: true, requestAuth: { apiKey, headers: buildSourceHeaders() } };
}

/*
 * Identity headers mirroring the CLI's buildZCodeSourceHeadersFromContext: the
 * plan gateway (zcode.z.ai behind an edge WAF) rejects model requests that
 * carry only an apiKey with business code 3012 "unusual activity" — the
 * desktop always sends these source headers, so the wrapper must too.
 */
const DEFAULT_HTTP_REFERER = "https://zcode.z.ai";

function normalizeHeaderValue(value) {
	const trimmed = value?.trim();
	return trimmed !== undefined && trimmed !== "" && /^[\x20-\x7e]+$/.test(trimmed)
		? trimmed
		: undefined;
}

function resolveDeviceMid() {
	const baseDir = (process.env.ZCODE_DATA_BASE_DIR ?? "").trim() || homedir();
	try {
		const parsed = JSON.parse(
			readFileSync(path.join(baseDir, ".zcode", "v2", "telemetry-state.json"), "utf-8"),
		);
		return normalizeHeaderValue(parsed?.deviceMid);
	} catch {
		return undefined;
	}
}

function normalizeOsCategory(platform) {
	switch (platform) {
		case "darwin": {
			return "macos";
		}
		case "win32": {
			return "windows";
		}
		default: {
			return "linux";
		}
	}
}

/*
 * Runner environments (sandcastle agents, CI) do not set ZCODE_APP_VERSION —
 * only the desktop injects it — and `ZCode/unknown` gets the same 3012 WAF
 * block as a header-less request. The desktop installs its CLI runtimes under
 * `.zcode/v2/runtime/provider/<platform>-<arch>/<semver>/` (dir names like
 * `windows-x86_64`, where node's arch is `x64`), and the newest version-named
 * dir is the version the desktop currently runs, so that is the honest
 * fallback. Matching on the platform prefix alone tolerates the arch-spelling
 * difference; versions are compared numerically, not lexically.
 */
function resolveAppVersionFallback() {
	const baseDir = (process.env.ZCODE_DATA_BASE_DIR ?? "").trim() || homedir();
	const providerRoot = path.join(baseDir, ".zcode", "v2", "runtime", "provider");
	const platformPrefix = `${normalizeOsCategory(process.platform)}-`;
	try {
		const versions = [];
		for (const dir of readdirSync(providerRoot)) {
			if (!dir.startsWith(platformPrefix)) {
				continue;
			}
			for (const entry of readdirSync(path.join(providerRoot, dir))) {
				if (
					/^\d+\.\d+\.\d+$/.test(entry) &&
					statSync(path.join(providerRoot, dir, entry)).isDirectory()
				) {
					versions.push(entry);
				}
			}
		}
		versions.sort((a, b) => {
			const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
			const [bMajor, bMinor, bPatch] = b.split(".").map(Number);
			return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
		});
		return versions[0];
	} catch {
		return undefined;
	}
}

let sourceHeadersCache;
function buildSourceHeaders() {
	if (sourceHeadersCache !== undefined) {
		return sourceHeadersCache;
	}

	const appVersion =
		normalizeHeaderValue(process.env.ZCODE_APP_VERSION) ?? resolveAppVersionFallback();
	const arch = normalizeHeaderValue(osArch());
	const clientLanguage =
		normalizeHeaderValue(Intl.DateTimeFormat().resolvedOptions().locale) ?? "unknown";
	const clientTimezone =
		normalizeHeaderValue(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "unknown";
	const deviceMid = resolveDeviceMid();
	const endpointOrigin =
		normalizeHeaderValue(process.env.ZCODE_ENDPOINT_ORIGIN) ?? DEFAULT_HTTP_REFERER;
	const osVersion = normalizeHeaderValue(osRelease());
	const platform = normalizeHeaderValue(process.platform);
	const releaseChannel = normalizeHeaderValue(process.env.ZCODE_RELEASE_CHANNEL);

	sourceHeadersCache = {
		"HTTP-Referer": endpointOrigin,
		"User-Agent": `ZCode/${appVersion ?? "unknown"}`,
		...(appVersion !== undefined ? { "X-ZCode-App-Version": appVersion } : {}),
		"X-Title": "Z Code@cli",
		...(platform !== undefined && arch !== undefined
			? { "X-Platform": `${platform}-${arch}` }
			: {}),
		...(releaseChannel !== undefined ? { "X-Release-Channel": releaseChannel } : {}),
		"X-Client-Language": clientLanguage,
		"X-Client-Timezone": clientTimezone,
		...(platform !== undefined ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
		...(osVersion !== undefined ? { "X-Os-Version": osVersion } : {}),
		...(deviceMid !== undefined ? { "X-Device-Mid": deviceMid } : {}),
	};
	return sourceHeadersCache;
}

let finished = false;
let turnError;
let resolveTurn;
const turnSettledPromise = new Promise((resolve) => {
	resolveTurn = (error) => {
		turnError = error;
		resolve(error);
	};
});

/** Resolves the pending turn exactly once; later terminal events are ignored. */
function settleTurn(error) {
	if (resolveTurn === undefined) {
		return;
	}

	const settle = resolveTurn;
	resolveTurn = undefined;
	settle(error);
}

/** PartId → next slice offset already emitted as a text event. */
const emittedTextLengths = new Map();
let lastToolEventKey = "";
let keepaliveTimer;

const TOOL_DETAIL_LIMIT = 400;

/** Trims a value into a bounded single string; non-strings fall back to JSON. */
function excerptValue(value) {
	if (typeof value === "string") {
		return value.trim().slice(0, TOOL_DETAIL_LIMIT);
	}

	if (typeof value === "object" && value !== null) {
		/*
		 * Inputs like {command: "..."} or {filePath: "..."} read better as the
		 * field value than as JSON; stringify only multi-field or non-string
		 * payloads.
		 */
		const entries = Object.entries(value).filter(
			([, fieldValue]) => typeof fieldValue === "string" && fieldValue.trim() !== "",
		);
		if (entries.length === 1) {
			return entries[0][1].trim().slice(0, TOOL_DETAIL_LIMIT);
		}

		if (entries.length > 1) {
			return entries
				.map(
					([key, fieldValue]) =>
						`${key}=${fieldValue.trim().slice(0, TOOL_DETAIL_LIMIT)}`,
				)
				.join(" ")
				.slice(0, TOOL_DETAIL_LIMIT);
		}
	}

	if (value === undefined || value === null) {
		return "";
	}

	try {
		return JSON.stringify(value).slice(0, TOOL_DETAIL_LIMIT);
	} catch {
		return "";
	}
}

/*
 * Extracts the readable slice of a tool.updated result payload — what ran and
 * what came back, mirroring what dirac's card bodies put in the digest.
 */
function toolResultDetail(result) {
	if (result === null || typeof result !== "object") {
		return excerptValue(result);
	}

	const pieces = [];
	const content = result.content ?? result.output ?? result.text;
	if (content !== null && typeof content === "object") {
		const output = excerptValue(content.content ?? content.text);
		if (output !== "") {
			pieces.push(`→ ${output}`);
		}
	} else {
		const output = excerptValue(content);
		if (output !== "") {
			pieces.push(`→ ${output}`);
		}
	}

	const perf = result.perf?.detail;
	if (perf?.command?.exitCode !== undefined) {
		pieces.push(`exit ${perf.command.exitCode}`);
	}

	if (result.success === false) {
		pieces.push("! failed");
	}

	return pieces.join("\n");
}

/*
 * Streaming progress detail while a tool runs: the running command (from
 * tool_input deltas) plus any output preview.
 */
function toolProgressDetail(progress, toolInputs) {
	const pieces = [];
	const input = excerptValue(toolInputs.get(progress.toolCallId));
	if (input !== "") {
		pieces.push(input);
	}

	const output = excerptValue(progress.outputPreview?.text ?? progress.stdoutTail);
	if (output !== "") {
		pieces.push(`→ ${output}`);
	}

	return pieces.join("\n");
}

/*
 * Readable detail for a legacy part.* tool event that reached a terminal
 * state: the part's own output/result/error slice.
 */
function toolDetail(part) {
	const state = part?.state ?? {};
	return excerptValue(state.output ?? state.result ?? state.error ?? state.text);
}

function markActivity() {
	if (keepaliveTimer !== undefined) {
		clearInterval(keepaliveTimer);
	}

	keepaliveTimer = setInterval(() => {
		emit({ type: "keep-alive" });
	}, HEARTBEAT_INTERVAL_MS);
	keepaliveTimer.unref?.();
}

function emitTextSlice(partId, fullText) {
	const emitted = emittedTextLengths.get(partId) ?? 0;
	if (fullText.length <= emitted) {
		emittedTextLengths.set(partId, Math.min(emitted, fullText.length));
		return;
	}

	const slice = fullText.slice(emitted);
	emittedTextLengths.set(partId, fullText.length);
	markActivity();
	emit({ type: "text", text: slice });
}

/** ToolCallId → accumulated tool_input text for progress detail. */
const toolInputs = new Map();
/** ToolCallId → last known tool name (result payloads omit toolName). */
const toolNames = new Map();
/** Signature of the last emitted tool event, for consecutive-duplicate suppression. */
let lastToolEmitKey = "";

/*
 * Emits one deduplicated tool event; returns true only when a line actually
 * went to stdout (deduped snapshots must not count as activity — see
 * markActivity).
 */
function emitToolEvent(name, state, detail) {
	const key = `${name}:${state}:${detail}`;
	if (key === lastToolEmitKey) {
		return false; // Real streams repeat started/running snapshots; keep the digest clean.
	}

	lastToolEmitKey = key;
	emit({ type: "tool", name, state, ...(detail !== "" ? { detail } : {}) });
	return true;
}

function handleModelStreaming(payload) {
	const kind = String(payload?.kind ?? "");
	if (kind === "text_delta") {
		const delta = String(payload?.delta ?? "");
		if (delta !== "") {
			markActivity();
			emit({ type: "text", text: delta });
		}
		return;
	}

	if (kind === "tool_input_start" || kind === "tool_input_delta") {
		toolInputs.set(
			payload?.toolCallId,
			(toolInputs.get(payload?.toolCallId) ?? "") +
				String(payload?.delta ?? payload?.input ?? ""),
		);
		if (typeof payload?.toolName === "string" && payload.toolName !== "") {
			toolNames.set(payload?.toolCallId, payload.toolName);
		}
		return;
	}

	if (kind === "tool_call") {
		if (typeof payload?.toolName === "string" && payload.toolName !== "") {
			toolNames.set(payload?.toolCallId, payload.toolName);
		}
		if (
			emitToolEvent(
				String(payload?.toolName ?? toolNames.get(payload?.toolCallId) ?? "unknown"),
				"started",
				"",
			)
		) {
			markActivity();
		}
	}
	/*
	 * reasoning_delta and tool_input_end emit nothing to stdout, so they must
	 * NOT mark activity: they arrive continuously while the model thinks, and
	 * re-arming the heartbeat here silenced it for entire thinking stretches —
	 * upstream's 600s idle watchdog then killed phases that were making
	 * progress (issue #174, design attempt 1).
	 */
}

function handleToolUpdated(payload) {
	const kind = String(payload?.kind ?? "");
	const toolCallId = payload?.toolCallId;
	if (typeof payload?.toolName === "string" && payload.toolName !== "") {
		toolNames.set(toolCallId, payload.toolName);
	}
	const name = String(payload?.toolName ?? toolNames.get(toolCallId) ?? "unknown");

	if (kind === "scheduled") {
		// Input may be omitted here; details come with tool_call + progress.
		return;
	}

	if (kind === "started") {
		if (emitToolEvent(name, "started", "")) {
			markActivity();
		}
		return;
	}

	if (kind === "progress") {
		if (emitToolEvent(name, "running", toolProgressDetail(payload, toolInputs))) {
			markActivity();
		}
		return;
	}

	if (kind === "result") {
		if (
			emitToolEvent(
				name,
				"completed",
				[excerptValue(toolInputs.get(toolCallId)), toolResultDetail(payload?.result)]
					.filter((piece) => piece !== "")
					.join("\n"),
			)
		) {
			markActivity();
		}
		return;
	}

	if (kind === "batch") {
		// Summary counts add nothing the per-tool events above missed.
	}
}

function handleSessionEvent(parameters) {
	const { type, payload } = parameters;
	if (type === "turn.completed") {
		markActivity();
		const usage = payload?.usage ?? {};
		emit({ type: "result", result: String(payload?.response ?? "") });
		emit({
			type: "usage",
			usage: {
				cacheCreationInputTokens: Number(usage.cacheWriteTokens ?? 0),
				cacheReadInputTokens: Number(usage.cacheReadTokens ?? 0),
				inputTokens: Number(usage.inputTokens ?? 0),
				outputTokens: Number(usage.outputTokens ?? 0),
			},
		});
		settleTurn(undefined);
		return;
	}

	if (type === "turn.failed") {
		settleTurn(
			new Error(
				`zcode turn failed: ${payload?.error?.message ?? JSON.stringify(payload?.error ?? payload)}`,
			),
		);
		return;
	}

	if (type === "model.streaming") {
		handleModelStreaming(payload);
		return;
	}

	if (type === "tool.updated") {
		handleToolUpdated(payload);
		return;
	}

	if (type === "session.titleUpdated") {
		const title = String(payload?.title ?? "");
		if (title !== "") {
			emit({ type: "note", text: `session title: ${title.slice(0, TOOL_DETAIL_LIMIT)}` });
		}
		return;
	}

	if (type === "part.started" || type === "part.upserted") {
		const part = payload?.part;
		if (part?.type === "text") {
			emitTextSlice(String(part.partId), String(part.text ?? ""));
			return;
		}

		if (part?.type === "tool") {
			const state = String(part.state?.status ?? "unknown");
			const key = `${part.tool}:${state}`;
			if (key !== lastToolEventKey) {
				lastToolEventKey = key;
				markActivity();
				emit({
					type: "tool",
					name: String(part.tool),
					state,
					...(key.includes("completed") || key.includes("failed") || key.includes("error")
						? { detail: toolDetail(part) }
						: {}),
				});
			}
		}

		// reasoning parts are dropped (matches the dirac provider's isReasoning filter)
		return;
	}

	// part.delta, streamRecovery.updated, session.updated and unknown types
	// carry nothing readable.
}

const stdout = createInterface({ input: child.stdout });
stdout.on("line", (line) => {
	const trimmed = line.trim();
	if (trimmed === "") {
		return;
	}

	let frame;
	try {
		frame = JSON.parse(trimmed);
	} catch {
		return;
	}

	if (frame.id !== undefined && (frame.result !== undefined || frame.error !== undefined)) {
		const pending = pendingRequests.get(frame.id);
		if (pending === undefined) {
			return;
		}

		pendingRequests.delete(frame.id);
		if (frame.error !== undefined) {
			pending.reject(
				new Error(
					`${pending.method}: ${frame.error.message ?? JSON.stringify(frame.error)}`,
				),
			);
		} else {
			pending.resolve(frame.result);
		}

		return;
	}

	if (frame.method !== undefined && frame.id !== undefined) {
		/*
		 * Handled asynchronously but never dropped: the runtime-header answer
		 * now resolves the credential store (possibly through the OS keyring)
		 * while the app-server blocks the model attempt on it. A rejection is
		 * still answered, so the turn fails loudly instead of hanging until
		 * its own timeout.
		 */
		void handleServerRequest(frame).catch((error) => {
			respond(frame.id, {
				errorMessage: `zcode-wrapper: request handler failed: ${error.message}`,
				headersApplied: false,
			});
		});
		return;
	}

	if (frame.method === "session/event") {
		handleSessionEvent(frame.params ?? {});
	}
});

async function shutdown(sessionId) {
	finished = true;
	if (keepaliveTimer !== undefined) {
		clearInterval(keepaliveTimer);
	}

	if (sessionId !== undefined) {
		try {
			await request("session/close", { sessionId }, 10_000);
		} catch {
			// Best-effort; the child is killed below regardless.
		}
	}

	child.stdin.end();
	setTimeout(() => {
		try {
			child.kill();
		} catch {
			// Already gone.
		}

		setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// Nothing left to do.
			}

			process.exit(0);
		}, 1_000);
	}, 100);
}

async function fail(message) {
	await writeFlushed(process.stderr, `zcode-wrapper: ${message}\n`);
	const tail = stderrTail.join("").trim();
	if (tail !== "") {
		await writeFlushed(
			process.stderr,
			`zcode-wrapper: --- zcode stderr (last ${stderrTail.length} chunks) ---\n${tail.slice(-8_000)}\n`,
		);
	}

	finished = true;
	child.kill();
	process.exit(1);
}

child.on("error", (error) => {
	void fail(`failed to spawn zcode (${binary}): ${error.message}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		finished = true;
		void writeFlushed(
			process.stderr,
			`zcode-wrapper: received ${signal}; aborting session\n`,
		).then(() => process.exit(130));
	});
}

const prompt = await new Promise((resolve, reject) => {
	let data = "";
	process.stdin.setEncoding("utf-8");
	process.stdin.on("data", (chunk) => {
		data += chunk;
	});
	process.stdin.on("end", () => {
		resolve(data);
	});
	process.stdin.on("error", reject);
});

const cwd = process.cwd();
const [providerId, ...modelIdParts] = args.model.split("/");
const hasExplicitModel =
	args.model !== "" && providerId !== "" && modelIdParts.join("/").trim() !== "";

/** `providerId/modelId` of a session snapshot's selection, or undefined when it carries none. */
function modelKeyOf(selection) {
	const provider = typeof selection?.providerId === "string" ? selection.providerId : "";
	const modelId = typeof selection?.modelId === "string" ? selection.modelId : "";
	return provider === "" || modelId === "" ? undefined : `${provider}/${modelId}`;
}

/**
 * Re-assert the requested model/effort on a resumed session.
 *
 * `session/resume` restores the persisted selection and ignores the request's `thoughtLevel`
 * entirely (and its strict schema rejects a `model` key), so a resume silently continues on
 * whatever model the session was created with. Sandcastle passes the model it wants on every
 * attempt, so apply the difference explicitly through the session-scoped mutators.
 *
 * The comparison reads the resumed snapshot's live selection (`settings.model.current` carries the
 * reasoning level; `session.model` is the bare `providerId/modelId`). The effort is only applied
 * when the session reports it among `settings.thoughtLevel.available`: `setThoughtLevel` throws for
 * a level the model does not register, and a model without reasoning levels must not fail a phase
 * over it. A model mismatch is fatal: running the phase on an unrequested model is the bug this
 * exists to prevent. `persistAsWorkspaceLastUsed` stays false so a sandcastle run never rewrites
 * the desktop app's last-used selection.
 */
async function applyResumedSelection(sessionId, snapshot) {
	const restored = snapshot?.settings?.model?.current ?? snapshot?.session?.model;
	const restoredEffort = snapshot?.settings?.thoughtLevel?.current ?? "";
	const availableLevels = Array.isArray(snapshot?.settings?.thoughtLevel?.available)
		? snapshot.settings.thoughtLevel.available
				.map((entry) => entry?.value)
				.filter((value) => typeof value === "string")
		: [];
	const effortSupported =
		args.effort !== "" &&
		(availableLevels.length === 0 || availableLevels.includes(args.effort));
	const requestedEffort = effortSupported ? args.effort : "";

	if (hasExplicitModel && modelKeyOf(restored) !== args.model) {
		try {
			await request(
				"session/setModel",
				{
					model: {
						modelId: modelIdParts.join("/"),
						providerId,
						...(requestedEffort !== ""
							? { options: { reasoningLevel: requestedEffort } }
							: {}),
					},
					persistAsWorkspaceLastUsed: false,
					sessionId,
				},
				30_000,
			);
			emitNote(
				`resumed session switched to ${args.model}${requestedEffort !== "" ? ` (${requestedEffort})` : ""}`,
			);
		} catch (error) {
			await fail(`session/setModel failed: ${error.message}`);
		}

		return;
	}

	if (args.effort !== "" && !effortSupported) {
		emitNoteOnce(
			`resumed session's model does not register reasoning level "${args.effort}" (available: ${availableLevels.join(", ") || "none"}); keeping the session's own level`,
		);
		return;
	}

	if (requestedEffort === "" || restoredEffort === requestedEffort) {
		return;
	}

	try {
		await request(
			"session/setThoughtLevel",
			{ persistAsWorkspaceLastUsed: false, sessionId, thoughtLevel: requestedEffort },
			30_000,
		);
		emitNote(`resumed session reasoning effort set to ${requestedEffort}`);
	} catch (error) {
		await fail(`session/setThoughtLevel failed: ${error.message}`);
	}
}

/*
 * Plan-mode account providers only resolve after the host delivers their
 * entitlement (see buildAccountDelivery) — push it before session/create so
 * the model selection validates against the refreshed registry.
 */
if (hasExplicitModel && providerId.startsWith("account:")) {
	await deliverAccountProviderConfig(providerId);
}

/*
 * Resume the persisted session when asked (the app-server's session/resume
 * keeps the conversation history), otherwise create a fresh one. The resume
 * schema is stricter than create's: a root `model` key is rejected with
 * "Unrecognized key: model" (verified against the desktop app-server), and
 * the resume path restores the persisted selection without reading the
 * request's `thoughtLevel` at all — see applyResumedSelection, which
 * re-asserts both on the resumed session.
 */
let created;
try {
	if (args.resumeSession !== "") {
		created = await request(
			"session/resume",
			{
				sessionId: args.resumeSession,
				/*
				 * `thoughtLevel` is accepted by the schema but never applied by the
				 * resume path; applyResumedSelection sets it through
				 * session/setThoughtLevel so the requested effort takes effect.
				 */
				workspace: { workspaceKey: cwd, workspacePath: cwd },
			},
			120_000,
		);
	} else {
		created = await request(
			"session/create",
			{
				mode: args.mode,
				/*
				 * "immediate" persists the session into zcode's shared store at
				 * create time, so the run is visible in the desktop app under this
				 * workspace even if it dies before its first turn completes
				 * ("deferred" only persists after a completed turn).
				 */
				persistence: "immediate",
				workspace: { workspaceKey: cwd, workspacePath: cwd },
				...(hasExplicitModel
					? {
							model: {
								modelId: modelIdParts.join("/"),
								providerId,
								...(args.effort !== ""
									? { options: { reasoningLevel: args.effort } }
									: {}),
							},
						}
					: {}),
				/*
				 * session/create flattens model.options after bootstrap validation
				 * (setModel receives "providerId/modelId"), so the thought level must
				 * also be re-applied top-level or level-required models fail their
				 * first turn with "Reasoning level is required".
				 */
				...(hasExplicitModel && args.effort !== "" ? { thoughtLevel: args.effort } : {}),
			},
			120_000,
		);
	}
} catch (err) {
	await fail(
		`${args.resumeSession !== "" ? "session/resume" : "session/create"} failed: ${err.message}`,
	);
}

const sessionId = created?.session?.sessionId;
if (sessionId === undefined || sessionId === "") {
	await fail(
		`${
			args.resumeSession !== "" ? "session/resume" : "session/create"
		} returned no sessionId: ${JSON.stringify(created)?.slice(0, 400)}`,
	);
}

emit({ type: "session_id", sessionId });

try {
	await request("session/subscribe", { deliveryKind: DELIVERY_KIND, sessionId }, 15_000);
} catch (err) {
	await fail(`session/subscribe failed: ${err.message}`);
}

/*
 * After subscribe (so the mutators' state.updated notifications have a
 * delivery target) and before send, so the first turn of the resumed
 * conversation already runs on the requested selection.
 */
if (args.resumeSession !== "") {
	await applyResumedSelection(sessionId, created);
}

markActivity();
try {
	await request("session/send", { content: prompt, sessionId }, 30_000);
} catch (err) {
	await shutdown(sessionId);
	await fail(`session/send failed: ${err.message}`);
}

await turnSettledPromise;
await shutdown(sessionId);

if (turnError !== undefined) {
	await fail(turnError.message);
}

process.exit(0);

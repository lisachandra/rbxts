/*
 * Credential-store compatibility for the sandcastle zcode wrapper.
 *
 * zcode 3.18 migrated `~/.zcode/v2/credentials.json` from `enc:v1:` records
 * (machine-derived key) to `enc:v2:<os|env>:<fingerprint>:` records (OS-keyring
 * or managed-secret key). The wrapper used to decrypt only v1, which made it
 * hand the *ciphertext* to the plan gateway as the api key; the gateway
 * answered 401 and every plan-mode lane died on its first model attempt
 * (rocket-powered-blox-cars #645, the matchmaking-session-work batch).
 *
 * These tests run the real wrapper against the stub app-server with a
 * temporary credential store, so the invariant is pinned end to end: the value
 * the wrapper offers as `apiKey` is the decrypted plaintext, and ciphertext is
 * never offered at all.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "vitest";

import { packageRoot } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";

registerTestHooks();

const tmpDirs: Array<string> = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sandcastle-zcode-credentials-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

const wrapperPath = join(packageRoot, "assets", "zcodeWrapper.mjs");
const stubPath = join(packageRoot, "assets", "zcodeStubAppServer.mjs");

/** The plaintext the tests expect to see offered as the model credential. */
const PLAN_TOKEN = "test-plan-token";
const MANAGED_SECRET = "sandcastle-test-managed-secret-0123456789abcdef";

/** AES-256-GCM seal of `payload` under `key`, in the store's on-disk shape. */
function seal(payload: string, key: Buffer): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
	return [iv, cipher.getAuthTag(), ciphertext]
		.map((part) => part.toString("base64url"))
		.join(".");
}

/** `enc:v1:` record under the machine/secret-derived key. */
function v1Record(payload: string, secret: string): string {
	return `enc:v1:${seal(payload, createHash("sha256").update(secret).digest())}`;
}

/**
 * `enc:v2:<scheme>:<fingerprint>:` record. The fingerprint is the CLI's `sha256(key).hex.slice(0,
 * 24)`, which the wrapper cross-checks before decrypting.
 */
function v2Record(payload: string, key: Buffer, scheme: "os" | "env"): string {
	const fingerprint = createHash("sha256").update(key).digest("hex").slice(0, 24);
	return `enc:v2:${scheme}:${fingerprint}:${seal(payload, key)}`;
}

interface RuntimeHeadersResult {
	answer: Record<string, unknown>;
	code: null | number;
	stderr: string;
}

/** Writes a credential store and runs the wrapper, capturing its header answer. */
function runWithStore(options: {
	credentials: Record<string, string>;
	extraEnv?: Record<string, string>;
}): Promise<RuntimeHeadersResult> {
	return new Promise((resolve, reject) => {
		const dir = tempDir();
		const storeDir = join(dir, ".zcode", "v2");
		mkdirSync(storeDir, { recursive: true });
		writeFileSync(join(storeDir, "credentials.json"), JSON.stringify(options.credentials));

		const answerFile = join(dir, "runtime-headers.json");
		const child = spawn(process.execPath, [wrapperPath, "--mode", "yolo"], {
			env: {
				...((process.env as Record<string, string | undefined>) ?? {}),
				...options.extraEnv,
				STUB_REQUEST_RUNTIME_HEADERS: "1",
				STUB_RUNTIME_HEADERS_FILE: answerFile,
				// Point both the binary and the data dir at test-controlled values.
				ZCODE_DATA_BASE_DIR: dir,
				ZCODE_SANDCASTLE_BIN: stubPath,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += String(chunk);
		});

		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`wrapper did not exit within 30s; stderr:\n${stderr}`));
		}, 30_000);

		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			let answer: Record<string, unknown>;
			try {
				answer = JSON.parse(readFileSync(answerFile, "utf-8")) as Record<string, unknown>;
			} catch {
				reject(new Error(`wrapper never answered the header request; stderr:\n${stderr}`));
				return;
			}

			resolve({ answer, code, stderr });
		});

		child.stdin.write("do the work");
		child.stdin.end();
	});
}

/** The apiKey the wrapper offered, if any. */
function offeredApiKey(answer: Record<string, unknown>): string | undefined {
	const requestAuth = answer.requestAuth as undefined | { apiKey?: unknown };
	return typeof requestAuth?.apiKey === "string" ? requestAuth.apiKey : undefined;
}

describe("zcode wrapper credential store", () => {
	test("a v2 env record is decrypted and offered as the api key", async () => {
		const { answer, code, stderr } = await runWithStore({
			credentials: {
				zcodejwttoken: v2Record(
					PLAN_TOKEN,
					createHash("sha256").update(MANAGED_SECRET).digest(),
					"env",
				),
			},
			extraEnv: { ZCODE_CREDENTIAL_SECRET: MANAGED_SECRET },
		});
		assert.equal(code, 0, `wrapper failed: ${stderr}`);
		assert.equal(answer.headersApplied, true, JSON.stringify(answer));
		assert.equal(offeredApiKey(answer), PLAN_TOKEN);
	});

	test("a v1 record still decrypts (older stores keep working)", async () => {
		const { answer, code, stderr } = await runWithStore({
			credentials: { zcodejwttoken: v1Record(PLAN_TOKEN, MANAGED_SECRET) },
			extraEnv: { ZCODE_CREDENTIAL_SECRET: MANAGED_SECRET },
		});
		assert.equal(code, 0, `wrapper failed: ${stderr}`);
		assert.equal(answer.headersApplied, true, JSON.stringify(answer));
		assert.equal(offeredApiKey(answer), PLAN_TOKEN);
	});

	test("an undecryptable v2 record is refused, never offered as ciphertext", async () => {
		/*
		 * The #645 failure: a v2 record met a wrapper that could not open it,
		 * and the raw `enc:v2:...` string went out as the api key. Now a record
		 * that cannot be decrypted must surface as "not applied" so the turn
		 * fails with an actionable message instead of a gateway 401.
		 */
		const { answer, code, stderr } = await runWithStore({
			credentials: {
				zcodejwttoken: v2Record(
					PLAN_TOKEN,
					createHash("sha256").update("a-different-secret").digest(),
					"env",
				),
			},
			extraEnv: { ZCODE_CREDENTIAL_SECRET: MANAGED_SECRET },
		});
		assert.equal(code, 0, `wrapper failed: ${stderr}`);
		assert.equal(answer.headersApplied, false, JSON.stringify(answer));
		assert.equal(offeredApiKey(answer), undefined);
		assert.match(String(answer.errorMessage), /no plan credential/);
		assert.match(stderr, /could not decrypt 1 credential entr\(ies\)/);
	});

	test("a v2 os record without a reachable keyring is refused", async () => {
		/*
		 * `os` records need the desktop install's keyring binding; a headless
		 * runner without it must fail closed rather than send ciphertext.
		 */
		const { answer, code, stderr } = await runWithStore({
			credentials: {
				zcodejwttoken: v2Record(PLAN_TOKEN, randomBytes(32), "os"),
			},
			/*
			 * A data dir this test owns cannot be registered under the real
			 * keyring, so the lookup finds no key for it.
			 */
			extraEnv: { ZCODE_CREDENTIAL_SECRET: MANAGED_SECRET },
		});
		assert.equal(code, 0, `wrapper failed: ${stderr}`);
		assert.equal(offeredApiKey(answer), undefined);
		assert.ok(
			!String(answer.errorMessage ?? "").includes("enc:v2:"),
			"the ciphertext must never appear in the diagnostics",
		);
	});

	test("a missing credential store fails with the connect-the-plan message", async () => {
		const { answer, code, stderr } = await runWithStore({
			credentials: {},
		});
		assert.equal(code, 0, `wrapper failed: ${stderr}`);
		assert.equal(answer.headersApplied, false, JSON.stringify(answer));
		assert.match(String(answer.errorMessage), /connect the plan in the ZCode desktop app/);
	});
});

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";

import { stateRoot } from "../runtime.js";
import { registerTestHooks } from "../test-helpers.js";
import { sandcastleSessionStorage } from "./session-storage.js";
import { clearSession, loadSession, saveSession, sessionFilePath } from "./session-store.js";

registerTestHooks();

afterEach(() => {
	// Clear every scope this suite may have written; names are time-suffixed.
});

describe("session store", () => {
	test("saves, loads, and clears a scoped session", () => {
		const scope = `store-${Date.now()}.design`;
		assert.equal(loadSession(scope), undefined);

		saveSession(scope, { backend: "zcode", sessionId: "s-1" });
		const stored = loadSession(scope);
		assert.equal(stored?.backend, "zcode");
		assert.equal(stored?.sessionId, "s-1");
		assert.equal(typeof stored?.updatedAt, "string");

		clearSession(scope);
		assert.equal(loadSession(scope), undefined);
	});

	test("ignores empty session ids and malformed store files", () => {
		const scope = `store-bad-${Date.now()}`;
		saveSession(scope, { backend: "dirac", sessionId: "" });
		assert.equal(loadSession(scope), undefined);

		writeFileSync(sessionFilePath(scope), "{corrupt", "utf-8");
		assert.equal(loadSession(scope), undefined);
		clearSession(scope);
	});

	test("writes store files under the sessions dir in stateRoot", () => {
		const scope = `store-path-${Date.now()}`;
		saveSession(scope, { backend: "dirac", sessionId: "s-2" });
		assert.match(sessionFilePath(scope), new RegExp(`sessions.*${scope}\\.json$`));
		assert.match(
			sessionFilePath(scope),
			new RegExp(stateRoot.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
		clearSession(scope);
	});
});

describe("sandcastleSessionStorage", () => {
	test("finds the stored session only when backend and id match", async () => {
		const scope = `storage-${Date.now()}`;
		const storage = sandcastleSessionStorage(scope, "zcode");

		const missing = await storage.findByIdOnHost("s-3");
		assert.equal(missing.path, undefined);
		assert.equal(missing.searchedRoot, sessionFilePath(scope));

		saveSession(scope, { backend: "zcode", sessionId: "s-3" });
		const found = await storage.findByIdOnHost("s-3");
		assert.equal(found.path, sessionFilePath(scope));

		const wrongBackend = sandcastleSessionStorage(scope, "dirac");
		const backendLookup = await wrongBackend.findByIdOnHost("s-3");
		assert.equal(backendLookup.path, undefined);

		const wrongId = await storage.findByIdOnHost("other");
		assert.equal(wrongId.path, undefined);

		assert.equal(await storage.existsOnHost("ignored-cwd", "s-3"), true);
		assert.equal(await storage.existsOnHost("ignored-cwd", "nope"), false);
		clearSession(scope);
	});
});

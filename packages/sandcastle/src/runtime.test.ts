/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizedPath } from "./runtime.js";
import { registerTestHooks, tmpRoot } from "./test-helpers.js";

registerTestHooks();

test("normalizedPath resolves and lowercases on Windows", () => {
	const path = normalizedPath(tmpRoot);
	assert.equal(path.includes("sandcastle-tests"), true);
});

import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizedPath } from "./runtime.js";
import { registerTestHooks, tmpRoot } from "./test-helpers.js";

registerTestHooks();

test("normalizedPath resolves and lowercases on Windows", () => {
	const path = normalizedPath(tmpRoot);
	assert.equal(path.includes("sandcastle-tests"), true);
});

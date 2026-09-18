/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import type { SetupWorktreeOptions } from "../worktree.js";
import { prepareIntegrationWorktree } from "./orchestrator.js";

registerTestHooks();

describe("orchestrator worktree setup seam", () => {
	test("should prepare integration worktree using shared setupWorktree", () => {
		const worktree = "/tmp/integration-worktree";
		let capturedWorktree: string | undefined;
		let capturedOptions: undefined | SetupWorktreeOptions;

		const preparer = (path: string, options: SetupWorktreeOptions): void => {
			capturedWorktree = path;
			capturedOptions = options;
		};

		// Default options → ignoreSetup/skipSetup false.
		prepareIntegrationWorktree(worktree, false, false, preparer);
		assert.equal(capturedWorktree, worktree);
		assert.deepEqual(capturedOptions, { ignoreSetup: false, skipSetup: false });

		// Options forwarded exactly.
		prepareIntegrationWorktree(worktree, true, true, preparer);
		assert.deepEqual(capturedOptions, { ignoreSetup: true, skipSetup: true });

		// If no preparer is injected it defaults to the shared setupWorktree (compile-time only).
		assert.equal(typeof prepareIntegrationWorktree, "function");
	});
});

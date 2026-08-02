/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
	getLatestReviewMarker,
	isIssueBlocked,
	isIssueComplete,
	readState,
	updatePhase,
	writeState,
} from "./state.js";
import {
	cleanupIssueArtifacts,
	makeState,
	registerTestHooks,
	stateDir,
	stubExecSync,
	uniqueIssue,
} from "./test-helpers.js";

registerTestHooks();

describe("phase state", () => {
	test("readState handles missing and invalid JSON; updatePhase writes", () => {
		const issue = uniqueIssue();
		assert.equal(readState(issue), undefined);

		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, `${issue}.json`), "{not-json", "utf-8");
		assert.equal(readState(issue), undefined);

		const state = makeState(issue);
		writeState(state);
		updatePhase(state, "design", "done", { note: true });
		const loaded = readState(issue);
		assert.equal(loaded?.phases.design.status, "done");
		assert.equal((loaded?.phases.design.extra as { note?: boolean })?.note, true);

		cleanupIssueArtifacts(issue);
	});

	test("isIssueComplete and review markers", () => {
		const issue = uniqueIssue();
		assert.equal(isIssueComplete(issue), false);

		writeState(
			makeState(issue, {
				commits: ["abc"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);
		assert.equal(isIssueComplete(issue), true);

		stubExecSync(
			JSON.stringify({
				comments: [
					{ body: "Sandcastle-Review: BLOCKED" },
					{ body: "noise" },
					{ body: "Sandcastle-Review: APPROVED" },
				],
			}),
		);
		assert.equal(getLatestReviewMarker(issue), "APPROVED");
		assert.equal(isIssueBlocked(issue), false);

		stubExecSync(
			JSON.stringify({
				comments: [{ body: "Sandcastle-Review: BLOCKED" }],
			}),
		);
		assert.equal(isIssueBlocked(issue), true);

		cleanupIssueArtifacts(issue);
	});
});

/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fetchIssueLabels, issueMetadata, issueView } from "./issue-metadata.js";
import { io } from "./runtime.js";
import { registerTestHooks, stubExecSync } from "./test-helpers.js";

registerTestHooks();

const LABELS_JSON = JSON.stringify({ labels: [{ name: "ecs" }, { name: "" }, {}] });

describe("issue metadata seam", () => {
	test("issueView returns the configured issue-view command with {issue} replaced", () => {
		assert.equal(issueView("42"), "gh issue view 42");
	});

	test("should fetch issue title and labels through injected gh seam, returning fallbacks on failure", () => {
		let receivedCommand: string | undefined;
		const gh = (command: string): string => {
			receivedCommand = command;
			return JSON.stringify({ labels: [{ name: "ecs" }], title: "Test issue title" });
		};

		assert.deepEqual(issueMetadata("42", gh), {
			labels: ["ecs"],
			title: "Test issue title",
		});
		assert.equal(receivedCommand, "gh issue view 42 --json title,labels");
	});

	test("issueMetadata falls back to placeholders when gh throws", () => {
		const gh = (): string => {
			throw new Error("gh down");
		};

		assert.deepEqual(issueMetadata("42", gh), {
			labels: [],
			title: "(could not fetch)",
		});
	});

	test("issueMetadata falls back to placeholders on malformed payload", () => {
		const gh = (): string => "not-json";

		assert.deepEqual(issueMetadata("42", gh), {
			labels: [],
			title: "(could not fetch)",
		});
	});

	test("fetchIssueLabels returns [] on failure and parses labels through the gh seam", () => {
		let failing = true;
		const gh = (): string => {
			if (failing) {
				throw new Error("gh down");
			}

			return LABELS_JSON;
		};

		assert.deepEqual(fetchIssueLabels("1", gh), []);
		failing = false;
		assert.deepEqual(fetchIssueLabels("1", gh), ["ecs"]);
	});

	test("issueMetadata uses the default io.execSync gh runner", () => {
		stubExecSync(JSON.stringify({ labels: [{ name: "x" }], title: "T" }));
		assert.deepEqual(issueMetadata("7"), { labels: ["x"], title: "T" });

		io.execSync = () => {
			throw new Error("gh down");
		};

		assert.deepEqual(issueMetadata("7"), {
			labels: [],
			title: "(could not fetch)",
		});
	});
});

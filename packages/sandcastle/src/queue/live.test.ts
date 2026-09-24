/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks, stubExecSync } from "../test-helpers.js";
import { fetchLiveQueueState } from "./live.js";

registerTestHooks();

describe("queue live state", () => {
	test("fetches issue state and batched blocked-by edges via the gh/graphql seams", () => {
		const queries: Array<string> = [];
		const gh = (command: string): string => {
			if (command.startsWith("gh issue list")) {
				return JSON.stringify([
					{
						labels: [{ name: "ready-for-agent" }, { name: "wayfinder:u2" }],
						number: 5,
						state: "OPEN",
						title: "Five",
					},
					{ labels: [], number: 6, state: "closed", title: "Six" },
					{
						labels: [{ name: "ready-for-agent" }],
						number: 7,
						state: "OPEN",
						title: "Seven",
					},
				]);
			}

			if (command.startsWith("gh repo view")) {
				return "lisachandra/rbxts\n";
			}

			throw new Error(`unexpected gh command: ${command}`);
		};

		const graphql = (query: string): string => {
			queries.push(query);
			return JSON.stringify({
				data: {
					repository: {
						i5: {
							blockedBy: {
								nodes: [
									{ number: 6, state: "OPEN" },
									{ number: 7, state: "CLOSED" },
								],
							},
							number: 5,
							state: "OPEN",
						},
					},
				},
			});
		};

		const live = fetchLiveQueueState({
			gh,
			graphql,
			numbers: new Set(["5"]),
			readyLabel: "ready-for-agent",
		});

		assert.equal(queries.length, 1);
		assert.match(queries[0] ?? "", /repository\(owner: "lisachandra", name: "rbxts"\)/u);
		assert.match(queries[0] ?? "", /i5: issue\(number: 5\)/u);
		assert.deepEqual([...live.issues.keys()], ["5", "6", "7"]);

		const five = live.issues.get("5");
		assert.ok(five !== undefined);
		assert.equal(five.ready, true);
		assert.equal(five.wayfinder, true);
		assert.deepEqual(five.openBlockers, ["6"]);
		assert.equal(five.state, "OPEN");

		const six = live.issues.get("6");
		assert.ok(six !== undefined);
		assert.equal(six.state, "CLOSED");
		assert.equal(six.ready, false);

		assert.deepEqual(live.readyIssues, [
			{ number: "5", title: "Five" },
			{ number: "7", title: "Seven" },
		]);
	});

	test("GraphQL state is authoritative for referenced issues", () => {
		const gh = (command: string): string => {
			if (command.startsWith("gh issue list")) {
				return JSON.stringify([{ labels: [], number: 8, state: "OPEN", title: "Eight" }]);
			}

			if (command.startsWith("gh repo view")) {
				return "lisachandra/rbxts\n";
			}

			throw new Error(`unexpected gh command: ${command}`);
		};

		const live = fetchLiveQueueState({
			gh,
			graphql: () => {
				return JSON.stringify({
					data: {
						repository: {
							i8: { blockedBy: { nodes: [] }, number: 8, state: "CLOSED" },
						},
					},
				});
			},
			numbers: new Set(["8"]),
			readyLabel: "ready-for-agent",
		});

		const eight = live.issues.get("8");
		assert.ok(eight !== undefined);
		assert.equal(eight.state, "CLOSED");
		assert.deepEqual(eight.openBlockers, []);
	});

	test("skips the graphql call entirely when nothing is referenced", () => {
		let graphqlCalls = 0;
		const gh = (command: string): string => {
			if (command.startsWith("gh issue list")) {
				return JSON.stringify([
					{
						labels: [{ name: "ready-for-agent" }],
						number: 9,
						state: "OPEN",
						title: "Nine",
					},
				]);
			}

			throw new Error(`unexpected gh command: ${command}`);
		};

		const live = fetchLiveQueueState({
			gh,
			graphql: () => {
				graphqlCalls++;
				return "{}";
			},
			numbers: new Set<string>(),
			readyLabel: "ready-for-agent",
		});

		assert.equal(graphqlCalls, 0);
		assert.deepEqual(live.readyIssues, [{ number: "9", title: "Nine" }]);
	});

	test("tolerates referenced numbers missing from the issue list and missing graphql nodes", () => {
		const gh = (command: string): string => {
			if (command.startsWith("gh issue list")) {
				return "[]";
			}

			if (command.startsWith("gh repo view")) {
				return "lisachandra/rbxts\n";
			}

			throw new Error(`unexpected gh command: ${command}`);
		};

		const live = fetchLiveQueueState({
			gh,
			graphql: () => {
				return JSON.stringify({ data: { repository: {} } });
			},
			numbers: new Set(["11"]),
			readyLabel: "ready-for-agent",
		});

		assert.equal(live.issues.size, 0);
		assert.deepEqual(live.readyIssues, []);
	});

	test("throws a readable error when the issue-list payload is malformed", () => {
		assert.throws(() => {
			fetchLiveQueueState({
				gh: () => "not-json",
				numbers: new Set<string>(),
				readyLabel: "ready-for-agent",
			});
		}, /Could not list repository issues|unexpected payload/u);
	});

	test("throws a readable error when the repository cannot be resolved", () => {
		assert.throws(() => {
			fetchLiveQueueState({
				gh: (command: string): string => {
					if (command.startsWith("gh issue list")) {
						return JSON.stringify([
							{ labels: [], number: 1, state: "OPEN", title: "One" },
						]);
					}

					if (command.startsWith("gh repo view")) {
						return "";
					}

					throw new Error(`unexpected gh command: ${command}`);
				},
				numbers: new Set(["1"]),
				readyLabel: "ready-for-agent",
			});
		}, /Could not resolve the repository/u);
	});

	test("the default gh runner reads through io.execSync", () => {
		stubExecSync("[]");
		const live = fetchLiveQueueState({
			numbers: new Set<string>(),
			readyLabel: "ready-for-agent",
		});

		assert.deepEqual(live.readyIssues, []);
	});
});

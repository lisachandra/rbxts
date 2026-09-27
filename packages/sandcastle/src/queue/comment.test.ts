/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import { upsertGraphComment } from "./comment.js";
import { queueGraphCommentMarker } from "./graph.js";

registerTestHooks();

/** Records the `gh api` calls and answers the read with `commentIds`. */
function ghStub(commentIds: Array<string>): {
	api: (args: ReadonlyArray<string>) => string;
	calls: Array<Array<string>>;
} {
	const calls: Array<Array<string>> = [];

	return {
		api: (args) => {
			calls.push([...args]);
			return args[0]?.endsWith("/comments") === true ? commentIds.join("\n") : "";
		},
		calls,
	};
}

function upsert(commentIds: Array<string>): ReturnType<typeof ghStub> & { outcome: string } {
	const stub = ghStub(commentIds);
	const outcome = upsertGraphComment({
		body: `${queueGraphCommentMarker}\n## Queue run order\n`,
		ghApi: stub.api,
		issue: "412",
		repository: "lisachandra/rbxts",
	});

	return { ...stub, outcome };
}

describe("sticky queue graph comment", () => {
	test("an issue with no graph comment gets one posted", () => {
		const { calls, outcome } = upsert([]);

		assert.equal(outcome, "created");
		assert.match(
			calls[1]?.join(" ") ?? "",
			/^repos\/lisachandra\/rbxts\/issues\/412\/comments -f body=/u,
		);
	});

	test("a previous graph comment is patched instead of stacked on", () => {
		const { calls, outcome } = upsert(["9001"]);

		assert.equal(outcome, "updated");
		assert.match(
			calls[1]?.join(" ") ?? "",
			/repos\/lisachandra\/rbxts\/issues\/comments\/9001/u,
		);
		assert.equal(calls[1]?.[1], "-X");
		assert.equal(calls[1]?.[2], "PATCH");
	});

	test("the newest marker comment wins when the API reports several", () => {
		const { calls } = upsert(["9001", "9002"]);

		assert.match(calls[1]?.join(" ") ?? "", /comments\/9002/u);
	});

	test("the read pages every comment and filters on the marker", () => {
		const { calls } = upsert([]);
		const read = calls[0] ?? [];

		assert.equal(read[0], "repos/lisachandra/rbxts/issues/412/comments");
		assert.ok(read.includes("--paginate"));
		assert.match(read.at(-1) ?? "", /contains\("<!-- sandcastle:queue-graph -->"\)/u);
	});
});

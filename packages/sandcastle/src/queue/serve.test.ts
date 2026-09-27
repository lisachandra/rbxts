/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { describe, test } from "node:test";

import { registerTestHooks, tmpRoot } from "../test-helpers.js";
import type { QueueGraph } from "./graph.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import { emptyQueueManifest } from "./manifest.js";
import { computeQueueView, type QueueView } from "./render.js";
import { type QueueServer, startQueueServer } from "./serve.js";

registerTestHooks();

const repository = { name: "rbxts", owner: "lisachandra" };

function issue(number: string): LiveIssue {
	return {
		found: true,
		number,
		openBlockers: [],
		ready: true,
		state: "OPEN",
		title: `Issue ${number}`,
		wayfinder: false,
	};
}

/** One READY batch, which is all the server needs to answer for. */
function queueView(): QueueView {
	const state: LiveQueueState = {
		issues: new Map([["1", issue("1")]]),
		readyIssues: [],
		truncated: false,
	};

	return computeQueueView(
		{ ...emptyQueueManifest(), sequences: [{ issues: ["1"], name: "A1" }] },
		state,
		{},
	);
}

/** Sends a request with the path used verbatim, which `fetch` would normalize away. */
function rawGet(port: number, path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		request({ host: "127.0.0.1", path, port }, (response) => {
			const chunks: Array<string> = [];
			response.setEncoding("utf-8");
			response.on("data", (chunk: string) => {
				chunks.push(chunk);
			});
			response.on("end", () => resolve(chunks.join("")));
		})
			.on("error", reject)
			.end();
	});
}

/** A bundle holding the one file the fallback asks for. */
function bundleDir(): string {
	const dir = join(tmpRoot, "web-bundle");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "index.html"), '<div id="root"></div>', "utf-8");
	return dir;
}

/** Starts a server on a free port and always closes it, even when an assertion throws. */
async function withServer(
	options: { staticDir?: string; view: (strictGates: boolean) => QueueView },
	run: (server: QueueServer) => Promise<void>,
): Promise<void> {
	const server = await startQueueServer({ port: 0, repository, ...options });
	try {
		await run(server);
	} finally {
		await server.close();
	}
}

describe("queue serve", () => {
	test("the page, the graph, and the raw view all come from one view builder", async () => {
		const strictness: Array<boolean> = [];
		await withServer(
			{
				staticDir: bundleDir(),
				view: (strictGates) => {
					strictness.push(strictGates);
					return queueView();
				},
			},
			async (server) => {
				assert.equal(server.host, "127.0.0.1");
				assert.ok(server.port > 0, "port 0 must be replaced by the bound port");

				const page = await fetch(server.url);
				assert.equal(page.status, 200);
				assert.match(await page.text(), /<div id="root"><\/div>/u);

				const graphPayload = await fetch(`${server.url}api/graph`);
				const graph = (await graphPayload.json()) as QueueGraph;
				assert.deepEqual(
					graph.nodes.map((node) => node.id),
					["A1"],
				);
				assert.deepEqual(graph.repository, repository);

				const viewPayload = await fetch(`${server.url}api/queue?strict=1`);
				const view = (await viewPayload.json()) as QueueView;
				assert.deepEqual(
					view.sequences.map((sequence) => sequence.name),
					["A1"],
				);
				assert.deepEqual(
					strictness,
					[false, true],
					"?strict=1 asks the builder for the strict view",
				);
			},
		);
	});

	test("a second read reuses the cached view until ?refresh=1 asks again", async () => {
		let calls = 0;
		await withServer(
			{
				staticDir: bundleDir(),
				view: () => {
					calls += 1;
					return queueView();
				},
			},
			async (server) => {
				await fetch(`${server.url}api/queue`);
				await fetch(`${server.url}api/graph`);
				assert.equal(calls, 1, "the graph and the panel read one cached view");

				await fetch(`${server.url}api/queue?refresh=1`);
				assert.equal(calls, 2, "Refresh bypasses the cache rather than the rate limit");
			},
		);
	});

	test("a deep link is answered by the page, and a traversal never streams a file", async () => {
		await withServer({ staticDir: bundleDir(), view: () => queueView() }, async (server) => {
			const deep = await fetch(`${server.url}batch/A1`);
			assert.match(await deep.text(), /<div id="root"><\/div>/u);

			const body = await rawGet(server.port, "/%2e%2e/%2e%2e/package.json");
			assert.match(
				body,
				/<div id="root"><\/div>/u,
				"`..` in a URL serves the page, never the file it names",
			);
		});
	});

	test("a bundle that was never built answers with the build hint, not a stack trace", async () => {
		await withServer(
			{ staticDir: join(tmpRoot, "web-missing"), view: () => queueView() },
			async (server) => {
				const response = await fetch(server.url);
				assert.equal(response.status, 404);
				assert.match(await response.text(), /run `pnpm build`/u);
			},
		);
	});
});

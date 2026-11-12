import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { describe, test } from "vitest";

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

/** One raw response, status and body, for a request the gate is meant to decide. */
interface RawResponse {
	headers: Record<string, string | undefined | Array<string>>;
	status: number;
	text: string;
}

/**
 * Sends a method, path, and header set as given. `fetch` normalizes the path and forbids some
 * headers, so the gate's inputs have to be written onto the request directly.
 */
function rawRequest(
	port: number,
	options: { headers?: Record<string, string>; method?: string; path: string },
): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		request(
			{
				headers: options.headers,
				host: "127.0.0.1",
				method: options.method ?? "GET",
				path: options.path,
				port,
			},
			(response) => {
				const chunks: Array<string> = [];
				response.setEncoding("utf-8");
				response.on("data", (chunk: string) => {
					chunks.push(chunk);
				});
				response.on("end", () => {
					resolve({
						headers: response.headers as RawResponse["headers"],
						status: response.statusCode ?? 0,
						text: chunks.join(""),
					});
				});
			},
		)
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

describe("queue serve request gate", () => {
	/*
	 * The point of every rejection case is that the *server keeps running*: the pre-fix bug was a
	 * dead process, not a bad status, so the crash case sends a second request afterwards.
	 */
	test("a malformed percent-escape is a 400 and the server still answers", async () => {
		await withServer({ staticDir: bundleDir(), view: () => queueView() }, async (server) => {
			for (const path of ["/%", "/%E0%A4%A", "/%C0%AF"]) {
				const refused = await rawRequest(server.port, { path });
				assert.equal(refused.status, 400, `${path} must be a client error`);
			}

			const after = await fetch(server.url);
			assert.equal(after.status, 200, "a bad request must not take the server with it");
			assert.match(await after.text(), /<div id="root"><\/div>/u);
		});
	});

	test("a non-GET method is refused with Allow: GET", async () => {
		await withServer({ staticDir: bundleDir(), view: () => queueView() }, async (server) => {
			for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
				const refused = await rawRequest(server.port, { method, path: "/api/queue" });
				assert.equal(refused.status, 405, `${method} must not be served`);
				assert.equal(refused.headers.allow, "GET");
			}
		});
	});

	test("a foreign Origin on ?refresh=1 is refused without building the view", async () => {
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
				const refused = await rawRequest(server.port, {
					headers: { origin: "https://evil.example" },
					path: "/api/queue?refresh=1",
				});

				assert.equal(refused.status, 403);
				assert.equal(calls, 0, "a refused refresh must never reach gh");
			},
		);
	});

	test("a foreign Host is refused", async () => {
		await withServer({ staticDir: bundleDir(), view: () => queueView() }, async (server) => {
			const refused = await rawRequest(server.port, {
				headers: { host: "attacker.example" },
				path: "/api/queue",
			});

			assert.equal(refused.status, 403);
		});
	});

	test("a same-origin GET with no Origin is served normally", async () => {
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
				const served = await rawRequest(server.port, { path: "/api/queue" });

				assert.equal(served.status, 200);
				assert.equal(calls, 1, "ordinary browsing must still reach the builder");
			},
		);
	});

	test("a same-origin origin header is accepted", async () => {
		await withServer({ staticDir: bundleDir(), view: () => queueView() }, async (server) => {
			const served = await rawRequest(server.port, {
				headers: { origin: `http://127.0.0.1:${String(server.port)}` },
				path: "/api/queue",
			});

			assert.equal(served.status, 200);
		});
	});

	test("the traversal refusal survives the safe decoder", async () => {
		await withServer({ staticDir: bundleDir(), view: () => queueView() }, async (server) => {
			/* cspell:ignore cpackage fpackage -- both are the tail of an encoded `package.json`. */
			for (const path of [
				"/..%2f..%2fpackage.json",
				"/%2e%2e%5c%2e%2e%5cpackage.json",
				"/C:/Windows/win.ini",
				"//server/share/package.json",
			]) {
				const body = await rawGet(server.port, path);
				assert.match(
					body,
					/<div id="root"><\/div>/u,
					`${path} must fall through to the page`,
				);
			}
		});
	});
});

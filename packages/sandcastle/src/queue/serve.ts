/*
 * `queue serve`: the queue graph as a local page.
 *
 * A diagram in a comment is read-only - layers cannot be toggled, a node cannot be opened, and the
 * detail behind a batch stays in the manifest. This server is the only new boundary in the package:
 * it serves the same payload `queue graph` prints ({@link buildQueueGraph}) plus the raw view for the
 * detail panel, so the page and the CLI cannot disagree.
 *
 * `node:http` and `node:fs` only. No runtime dependency is added for a view whose only consumer is
 * the person who typed the command.
 */

import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve as pathResolve, sep } from "node:path";

import { config, packageRoot } from "../runtime.js";
import { sequenceGateNames, unmetIntegrationGates } from "./gates.js";
import { buildQueueGraph } from "./graph.js";
import { fetchLiveQueueState, resolveRepositoryIdentifiers } from "./live.js";
import { readQueueManifest, referencedIssues } from "./manifest.js";
import { computeQueueView, type QueueView } from "./render.js";

/** How long {@link startQueueServer} reuses a view before it asks `gh` again. */
const viewCacheMs = 30_000;

/** Port `queue serve` binds unless `--port` names another. */
const defaultPort = 4321;

/** Content types the bundle needs; anything else is streamed as a binary download. */
const contentTypes: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};

/**
 * - Builds the live queue view every queue command renders.
 * - @param strictGates - Count a gate that GitHub would satisfy as drift.
 * - @returns The manifest read live through `gh`, with the gate check folded in.
 * - @remarks The page asks for the same view `queue list` prints, so a batch cannot read READY in one
 *   rendering and GATED in the other.
 */
export function liveQueueView(strictGates: boolean): QueueView {
	const manifest = readQueueManifest();
	const live = fetchLiveQueueState({
		numbers: referencedIssues(manifest),
		readyLabel: config.labels.readyForAgent,
	});
	const gates = unmetIntegrationGates({ names: sequenceGateNames(manifest) });
	return computeQueueView(manifest, live, { gates, strictGates });
}

export interface QueueServeOptions {
	/** Bind address; `127.0.0.1` keeps the queue off the LAN. */
	host?: string;
	/** Port to bind; `0` asks the OS for a free one, which is what the tests do. */
	port?: number;
	/** `owner/name` for the payload's issue links; defaults to `gh repo view`. */
	repository?: { name: string; owner: string };
	/** Directory holding the built page; defaults to `<package root>/dist/web`. */
	staticDir?: string;
	/** View builder seam; defaults to {@link liveQueueView}. */
	view?: (strictGates: boolean) => QueueView;
}

/** A running `queue serve`. */
export interface QueueServer {
	/** Stops listening and waits for in-flight requests. */
	close(): Promise<void>;
	/** Resolves when the server stops listening. */
	closed: Promise<void>;
	host: string;
	port: number;
	/** `http://host:port/` — the URL to print and to open. */
	url: string;
}

/** One cached rendering: the view, the repository it was read from, and when. */
interface ViewCacheEntry {
	at: number;
	repository: { name: string; owner: string };
	view: QueueView;
}

/**
 * - Opens a URL in the platform's default browser.
 * - @param url - The page to open.
 * - @remarks `--open` is convenience, not a dependency: the launcher is spawned detached with its
 *   stdio ignored, so a machine with no browser never takes the server down with it.
 */
export function openBrowser(url: string): void {
	const { args, command } = browserLauncher(url);
	spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

/** `cmd /c start` on Windows, `open` on macOS, `xdg-open` everywhere else. */
function browserLauncher(url: string): { args: Array<string>; command: string } {
	if (process.platform === "win32") {
		/* The empty string is the window title `start` would otherwise consume the URL as. */
		return { args: ["/c", "start", "", url], command: "cmd" };
	}

	return process.platform === "darwin"
		? { args: [url], command: "open" }
		: { args: [url], command: "xdg-open" };
}

/**
 * - Resolves a request path inside the served bundle, or nothing when it leaves it.
 * - @param staticDir - Directory the page was built into.
 * - @param pathname - Request path, still percent-encoded.
 * - @returns The absolute file path, or `undefined` for a miss or a traversal attempt.
 * - @remarks The caller has already refused a malformed escape (see {@link gateRequest}), so the
 *   decode here cannot throw. The containment check earns its place on the decoded result: `../` in
 *   a URL is never a request the page itself makes, so a path that resolves outside the bundle is
 *   refused even though the socket is loopback-only.
 */
function resolveStatic(staticDir: string, pathname: string): string | undefined {
	const root = pathResolve(staticDir);
	const candidate = pathResolve(root, `.${decodeURIComponent(pathname)}`);
	if (candidate !== root && !candidate.startsWith(root + sep)) {
		return undefined;
	}

	return existsSync(candidate) && statSync(candidate).isFile() ? candidate : undefined;
}

/** Why a request was refused before routing; `status` is what the client sees. */
interface GateRejection {
	message: string;
	status: number;
}

/** Whether a host names a loopback address, so `--host` leaving it can be reported as exposure. */
export function isLoopbackHost(host: string): boolean {
	return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * - The one gate every request passes before routing.
 * - @param request - The incoming request; its method, target, and `origin`/`host` headers are read.
 * - @param boundHost - The host the server bound, which is the only one it answers to.
 * - @param boundPort - The port the server bound, which an `Origin` must also name.
 * - @returns A rejection when the request must not be served, or `undefined` to proceed.
 * - @remarks Four checks, in the order a client would trip them:
 *
 *   - **Method.** `GET` only. The page has no write endpoint, so any other verb is a mistake at best.
 *   - **Path.** A percent-escape that does not decode is a `400`. Answering it with the page would hide
 *     a malformed request behind a successful-looking one, and letting it through would throw out of
 *     the handler and kill the process.
 *   - **Origin.** A request with no `Origin` is a top-level navigation, a `curl`, or an image request —
 *     browsers omit it for those, so refusing them would break ordinary browsing. A present `Origin`
 *     must be this server's own; anything else stops a cross-origin `fetch` from reading the queue
 *     (private issue titles, batch notes) and from spending the `gh` token budget through
 *     `?refresh=1`.
 *   - **Host.** Pinning it is the DNS-rebinding defence: a page served from an attacker domain that
 *     resolves to `127.0.0.1` is same-origin with the API unless the `Host` it sends is refused.
 *
 *   No CORS header is ever sent, because one would undo the origin check. The gate runs before
 *   routing and before the view cache is touched, so a refused `?refresh=1` never spawns `gh`.
 */
function gateRequest(
	request: IncomingMessage,
	boundHost: string,
	boundPort: number,
): undefined | GateRejection {
	if (request.method !== "GET") {
		return { message: "Only GET is served.", status: 405 };
	}

	/*
	 * A malformed escape is a malformed request, not a deep link: `decodeURIComponent` would throw
	 * inside the handler and take the process down, and answering 400 keeps that failure a status.
	 */
	if (!isDecodable(request.url ?? "/")) {
		return { message: "Malformed percent-escape in the request path.", status: 400 };
	}

	const { origin } = request.headers;
	if (origin !== undefined && origin !== "" && !isSameOrigin(origin, boundHost, boundPort)) {
		return { message: "Cross-origin requests are refused.", status: 403 };
	}

	const host = headerValue(request.headers.host);
	if (host !== undefined && !isBoundHost(host, boundHost, boundPort)) {
		return { message: "Unexpected Host header.", status: 403 };
	}

	return undefined;
}

/** A header as a single string; a repeated header is joined rather than read as an array. */
function headerValue(value: string | undefined | Array<string>): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	return Array.isArray(value) ? value.join(",") : value;
}

/** Whether every percent-escape in a request target decodes. */
function isDecodable(target: string): boolean {
	try {
		decodeURIComponent(target);
		return true;
	} catch {
		return false;
	}
}

/** Whether an `Origin` value names exactly this server. */
function isSameOrigin(origin: string, boundHost: string, boundPort: number): boolean {
	return origin === `http://${boundHost}:${boundPort}` || origin === `http://${boundHost}`;
}

/**
 * - Whether a `Host` header names the bound address.
 * - @remarks The port is compared only when the header carries one, because a client using the
 *   default port legitimately omits it. The host itself must match exactly, so `localhost:4321`
 *   against a `127.0.0.1` bind is refused: the rebinding defence is worth that one false negative,
 *   and the URL the CLI prints is the one that works.
 */
function isBoundHost(hostHeader: string, boundHost: string, boundPort: number): boolean {
	const match = /^(.*?):(\d+)$/u.exec(hostHeader);
	if (match === null) {
		return hostHeader === boundHost;
	}

	return match[1] === boundHost && Number(match[2]) === boundPort;
}

function sendFile(response: ServerResponse, path: string): void {
	response.writeHead(200, {
		"content-type": contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
	});
	createReadStream(path).pipe(response);
}

function sendJson(response: ServerResponse, value: unknown): void {
	response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
	response.end(`${JSON.stringify(value, undefined, 2)}\n`);
}

function sendError(response: ServerResponse, status: number, message: string): void {
	response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
	response.end(`${message}\n`);
}

/** The served bundle: the `web/` build, or wherever a test points the server. */
function defaultStaticDir(): string {
	return join(packageRoot, "dist", "web");
}

/**
 * - Serves the queue page and its two JSON endpoints on the loopback interface.
 * - @param options - Bind address, port, static directory, and the view seam the tests drive.
 * - @returns A handle whose `url` is the page, and whose `closed` promise resolves on shutdown.
 * - @remarks The view is cached for {@link viewCacheMs}: every read spawns `gh`, so a page that
 *   reloaded on every focus would spend more of the token budget than a queue run does.
 *   `?refresh=1` bypasses the cache, which is what the Refresh button sends.
 * - @throws {Error} When the port is taken or the host cannot be bound.
 */
export async function startQueueServer(options: QueueServeOptions = {}): Promise<QueueServer> {
	const host = options.host ?? "127.0.0.1";
	const staticDir = options.staticDir ?? defaultStaticDir();
	const buildView = options.view ?? liveQueueView;
	const cache = new Map<boolean, ViewCacheEntry>();
	/**
	 * The port actually bound, which is not known until `listen` resolves: the tests pass `0`. The
	 * gate compares an `Origin`/`Host` against it, so it is read at request time, never captured.
	 */
	let boundPort = options.port ?? defaultPort;

	function viewFor(strictGates: boolean, refresh: boolean): ViewCacheEntry {
		const cached = cache.get(strictGates);
		if (!refresh && cached !== undefined && Date.now() - cached.at < viewCacheMs) {
			return cached;
		}

		const entry: ViewCacheEntry = {
			at: Date.now(),
			repository: options.repository ?? resolveRepositoryIdentifiers(),
			view: buildView(strictGates),
		};
		cache.set(strictGates, entry);
		return entry;
	}

	const server = createServer((request, response) => {
		/*
		 * The gate runs before routing and before the view cache: a refused `?refresh=1` must never
		 * reach `gh`, which is why the call count is what a spec asserts rather than the status alone.
		 */
		const rejection = gateRequest(request, host, boundPort);
		if (rejection !== undefined) {
			if (rejection.status === 405) {
				response.setHeader("allow", "GET");
			}

			sendError(response, rejection.status, rejection.message);
			return;
		}

		const url = new URL(request.url ?? "/", `http://${host}`);
		const refresh = url.searchParams.get("refresh") === "1";

		if (url.pathname === "/api/graph") {
			const entry = viewFor(false, refresh);
			sendJson(
				response,
				buildQueueGraph(entry.view, {
					generatedAt: new Date(entry.at).toISOString(),
					repository: entry.repository,
				}),
			);
			return;
		}

		if (url.pathname === "/api/queue") {
			sendJson(response, viewFor(url.searchParams.get("strict") === "1", refresh).view);
			return;
		}

		const file = resolveStatic(staticDir, url.pathname) ?? join(staticDir, "index.html");
		if (existsSync(file)) {
			sendFile(response, file);
			return;
		}

		sendError(response, 404, "The queue page is not built; run `pnpm build` and retry.");
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? defaultPort, host, () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address();
	boundPort = typeof address === "object" && address !== null ? address.port : defaultPort;
	const port = boundPort;
	return {
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
		closed: new Promise<void>((resolve) => {
			server.once("close", resolve);
		}),
		host,
		port,
		url: `http://${host}:${port}/`,
	};
}

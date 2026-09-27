/*
 * Vite config for the queue page.
 *
 * Both paths are derived from this file rather than from the working directory, so
 * `vite build --config web/vite.config.ts` produces `dist/web` from either the package directory
 * or the repo root. `emptyOutDir: false` is deliberate: `dist` also holds the compiled CLI, which
 * the build runs next to.
 */

import react from "@vitejs/plugin-react";

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = fileURLToPath(new URL("../dist/web", import.meta.url));

/** Port `queue serve` binds by default; `pnpm web:dev` proxies `/api` to it. */
const servedPort = 4321;

export default defineConfig({
	base: "./",
	build: {
		emptyOutDir: false,
		outDir,
	},
	plugins: [react()],
	root,
	server: {
		proxy: {
			"/api": `http://127.0.0.1:${servedPort}`,
		},
	},
});

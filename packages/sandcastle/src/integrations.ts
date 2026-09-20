/*
 * Integration composition barrel.
 *
 * Re-exports the three deep modules that own integration composition — the manifest lifecycle
 * (`integration/manifest.ts`), the git merge contract (`integration/merger.ts`), and the state
 * machine/lifecycle orchestrator (`integration/orchestrator.ts`). This module exists purely for
 * backwards compatibility: `src/main.ts` and downstream consumers keep a single import surface.
 */

export * from "./integration/manifest.js";
export * from "./integration/merger.js";
export * from "./integration/orchestrator.js";

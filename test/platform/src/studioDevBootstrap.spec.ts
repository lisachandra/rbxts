/*
 * The Studio development bootstrap's selection verdict (issue #665).
 *
 * In the Studio development hot-reload context the platform's `resolveBoundary` used to skip the
 * `modules` walk entirely, and matter's container scan then collected every system module under the
 * containers regardless of the caller's selection, so that selection was inert: the Loop ran the
 * unfiltered systems tree. The contract now is that the walk is authoritative in both contexts - in
 * production its selection is the schedule, in the development hot-reload context its selection is
 * the verdict the container scan obeys.
 *
 * These specs pin the boundary contract: which arrays `resolveBoundary` yields in each context, and
 * that a system's `meta` table is carried by reference so the scan can match it by identity. The
 * end-to-end scan behaviour (a dropped module's clone never running) is pinned by the game's own
 * `studioDevBootstrap.spec.ts`, which owns the real containers.
 */

import { resolveBoundary } from "@lisachandra/platform";
import { describe, expect, it } from "@rbxts/jest-globals";
import { RunService } from "@rbxts/services";

/**
 * The module slot `resolveBoundary` reads on this runtime.
 *
 * @remarks
 *   The walk is role-scoped: `resolveBoundary` reads `modules[scope]` where `scope` is `"client"`
 *   on a client and `"server"` on a server. This lane runs client-side, so the `server` slot is
 *   silently ignored - derive the slot instead of hardcoding one and the spec stays honest on
 *   both.
 */
const SCOPE = RunService.IsClient() ? "client" : "server";

/**
 * A synthetic system leaf, shaped exactly as the barrel walk expects.
 *
 * @remarks
 *   `findSystems` only walks plain tables looking for `meta`, so a table literal is a faithful
 *   leaf. Authoring a real `ModuleScript` instead would mean compiling `Source` at runtime, which
 *   this harness does not do.
 */
function systemLeaf(name: string): { meta: object } {
	return { meta: { system: () => name } };
}

/** Identity membership: the verdict carries the leaf's `meta` table by reference, never by value. */
function hasLeaf(filter: ReadonlyArray<unknown>, leaf: { meta: object }): boolean {
	for (const entry of filter) {
		if (entry === leaf.meta) {
			return true;
		}
	}

	return false;
}

describe("studio development bootstrap", () => {
	it("should carry the modules walk as the development boundary's selection verdict", () => {
		expect.hasAssertions();

		const allowedA = systemLeaf("allowedSystemA");
		const allowedB = systemLeaf("allowedSystemB");
		const dropped = systemLeaf("droppedSystem");
		const barrel = {
			authority: { allowedSystemA: allowedA },
			security: { allowedSystemB: allowedB },
		};

		const boundary = resolveBoundary({
			hotReload: { containers: [new Instance("Folder")] },
			mode: "development",
			modules: { [SCOPE]: barrel },
		});

		// The walk is the verdict, not the schedule: `systems` stays empty in the dev context ...
		expect(boundary.systems.size()).toBe(0);

		// ... and the walked meta tables ride the boundary as the verdict the scan must obey.
		const filter = boundary.filterSystems;

		expect(filter).toBeDefined();
		expect(filter!.size()).toBe(2);
		expect(hasLeaf(filter!, allowedA)).toBe(true);
		expect(hasLeaf(filter!, allowedB)).toBe(true);
		// The leaf outside the selection is not in the verdict.
		expect(hasLeaf(filter!, dropped)).toBe(false);
	});

	it("should keep the production schedule as the modules walk", () => {
		expect.hasAssertions();

		const allowedA = systemLeaf("allowedSystemD");
		const allowedB = systemLeaf("allowedSystemE");
		const barrel = {
			authority: { allowedSystemD: allowedA },
			security: { allowedSystemE: allowedB },
		};

		const boundary = resolveBoundary({
			hotReload: { containers: [new Instance("Folder")] },
			mode: "production",
			modules: { [SCOPE]: barrel },
		});

		// A published server never took the hot-reload path: the walk IS the schedule, unchanged ...
		expect(boundary.systems.size()).toBe(2);
		expect(hasLeaf(boundary.systems, allowedA)).toBe(true);
		expect(hasLeaf(boundary.systems, allowedB)).toBe(true);

		// ... and no verdict rides the boundary, so the scan stays unfiltered if it ever runs.
		expect(boundary.filterSystems).toBeUndefined();
	});

	it("should leave the development scan unfiltered when no modules verdict is provided", () => {
		expect.hasAssertions();

		const containers = [new Instance("Folder")];

		// No `modules` at all: the caller gave no verdict, so none rides the boundary ...
		const noVerdict = resolveBoundary({ hotReload: { containers }, mode: "development" });

		expect(noVerdict.filterSystems).toBeUndefined();

		/*
		 * ... while `{}` is an empty verdict, not no verdict: production schedules nothing from it,
		 * so development parity filters everything out of the scan.
		 */
		const emptyVerdict = resolveBoundary({
			hotReload: { containers },
			mode: "development",
			modules: {},
		});
		const emptyFilter = emptyVerdict.filterSystems;

		expect(emptyFilter).toBeDefined();
		expect(emptyFilter!.size()).toBe(0);
	});
});

import {
	findClientEntityIdFromInstance,
	findServerEntityIdFromInstance,
	getComponentObject,
	getComponentPosition,
} from "@lisachandra/matter/utils/entity";
import { describe, expect, it } from "@rbxts/jest-globals";

/*
 * Ported from the godkin repo's `shared/utils/entity.spec.ts` (#17 triage: rewrite, 195 lines).
 *
 * The upstream spec built a full `World` and inserted profile/NPC/item/node components to check
 * `getComponentObject`'s four branches. Those component types (`ProfileComponents`, `NPCComponents`)
 * were never extracted into this repo, so that half does not port — what does is the ancestry walk,
 * which is the part with a real invariant: an attribute on a parent must be visible from a deep
 * child, and the nearest one must win.
 *
 * `isAlive`, `ownsEntity` and the position getters need a populated world and a running `Players`
 * service; they are listed at the bottom as deliberately absent.
 */
describe("findServerEntityIdFromInstance", () => {
	it("should find the attribute on the instance itself", () => {
		expect.assertions(1);

		const instance = new Instance("Folder");
		instance.SetAttribute("serverEntityId", 42);

		expect(findServerEntityIdFromInstance(instance)).toBe(42);
	});

	it("should walk up to an ancestor that carries the attribute", () => {
		expect.assertions(1);

		const root = new Instance("Folder");
		root.SetAttribute("serverEntityId", 7);
		const middle = new Instance("Folder");
		const leaf = new Instance("Folder");
		middle.Parent = root;
		leaf.Parent = middle;

		expect(findServerEntityIdFromInstance(leaf)).toBe(7);
	});

	it("should prefer the nearest ancestor's value", () => {
		expect.assertions(1);

		/*
		 * The walk is `??`-chained from the instance upward, so the first attribute found wins. A
		 * repository-wide re-parent could otherwise leave a child pointing at its old entity.
		 */
		const root = new Instance("Folder");
		root.SetAttribute("serverEntityId", 1);
		const child = new Instance("Folder");
		child.SetAttribute("serverEntityId", 2);
		child.Parent = root;

		expect(findServerEntityIdFromInstance(child)).toBe(2);
	});

	it("should answer undefined when no ancestor carries the attribute", () => {
		expect.assertions(2);

		const root = new Instance("Folder");
		const leaf = new Instance("Folder");
		leaf.Parent = root;

		expect(findServerEntityIdFromInstance(leaf)).toBeUndefined();
		expect(findServerEntityIdFromInstance()).toBeUndefined();
	});
});

describe("findClientEntityIdFromInstance", () => {
	it("should find the attribute on the instance itself", () => {
		expect.assertions(1);

		const instance = new Instance("Folder");
		instance.SetAttribute("clientEntityId", 11);

		expect(findClientEntityIdFromInstance(instance)).toBe(11);
	});

	it("should walk up to an ancestor that carries the attribute", () => {
		expect.assertions(1);

		const root = new Instance("Folder");
		root.SetAttribute("clientEntityId", 3);
		const leaf = new Instance("Folder");
		leaf.Parent = root;

		expect(findClientEntityIdFromInstance(leaf)).toBe(3);
	});

	it("should not read the server attribute", () => {
		expect.assertions(1);

		// The two walks are separate on purpose: a client id is not a fallback for a server id.
		const instance = new Instance("Folder");
		instance.SetAttribute("serverEntityId", 9);

		expect(findClientEntityIdFromInstance(instance)).toBeUndefined();
	});
});

describe("getComponentObject", () => {
	it("should answer undefined for a missing component", () => {
		expect.assertions(1);

		expect(getComponentObject()).toBeUndefined();
	});

	it("should answer undefined for a component with no Instance field", () => {
		expect.assertions(1);

		// A component that carries only data has no object to return; the getter must not invent one.
		expect(getComponentObject({ health: 5 } as never)).toBeUndefined();
	});

	it("should return the Instance a component carries", () => {
		expect.assertions(1);

		const instance = new Instance("Folder");

		expect(getComponentObject({ model: instance } as never)).toBe(instance);
	});
});

describe("getComponentPosition", () => {
	it("should answer undefined for a missing component", () => {
		expect.assertions(1);

		expect(getComponentPosition()).toBeUndefined();
	});

	it("should return the position of the component's object", () => {
		expect.assertions(1);

		/*
		 * A `Part` is the cheapest PVInstance the emulator can create with a position. The function
		 * reads `Position` off the object it finds, so this pins the wiring rather than the arithmetic.
		 */
		const part = new Instance("Part");
		part.Position = new Vector3(1, 2, 3);

		expect(getComponentPosition({ model: part } as never)).toEqual(new Vector3(1, 2, 3));
	});
});

/*
 * Deliberately not ported:
 *
 * - `isAlive` and `ownsEntity` read `Players.LocalPlayer` and a populated `store`; the emulator has
 *   no player and the store is per-lane state, so a port would assert against stubs.
 * - The four `getComponentObject` branches for profile/NPC/item/node components need component types
 *   that were never extracted into this repo (#17's triage listed them under the item rewrite, not
 *   this spec).
 * - `getEntityObject` and `getEntityPosition` read `store.world` directly, and that field is nil until
 *   a bootstrap assigns it. Calling either before then raises `attempt to index nil with 'contains'`
 *   from the first line of a `? :` chain — an incidental nil dereference, not a guard with a message
 *   worth pinning. Asserting it would freeze a crash into a contract, so the honest place for this is
 *   here: both need a bootstrapped world, which the emulator does not build.
 */

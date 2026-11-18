import { useChange } from "@lisachandra/matter/hooks/useChange";
import { describe, expect, it } from "@rbxts/jest-globals";
import Signal from "@rbxts/lemon-signal";
import { Loop, World } from "@rbxts/matter";

/*
 * Ported from the godkin repo's `shared/matter/hooks/useChange.spec.ts` (#17 triage: rewrite).
 *
 * The subject is unchanged — `useChange` compares this frame's dependency array against the previous
 * one and answers `true` when they differ or on the first frame. What changed is the harness: the
 * RuntimeLib mock is gone (this module imports the package entry directly), and the `Loop`/`Signal`
 * scaffolding is local to each spec so a failing one cannot leak a scheduled system into the next.
 */

/*
 * A world, a loop and a synthetic frame event.
 *
 * `Loop:begin` types its argument as a map of `RBXScriptSignal`, but the docs say any object with a
 * `Connect` works — the cast is the price of using a signal the engine did not create. `Signal` from
 * `@rbxts/lemon-signal` provides `Connect`, `Fire` and `Disconnect` without a data model.
 *
 * The three members are returned as plain fields rather than methods: roblox-ts rejects throwing away
 * an object's methods, and every caller here takes the fields apart.
 */
function harness() {
	const world = new World();
	const loop = new Loop(world);
	const event = new Signal();
	const connections = loop.begin({ default: event } as unknown as Record<
		string,
		RBXScriptSignal
	>);

	return {
		disconnect: () => {
			for (const [, connection] of pairs(connections)) {
				connection.Disconnect();
			}
		},
		fire: () => {
			event.Fire();
		},
		loop,
	};
}

describe("useChange", () => {
	it("should refuse to run outside a Loop-system context", () => {
		expect.assertions(1);

		/*
		 * `useHookState` is topologically aware: it resolves the calling system from a per-frame
		 * stack. Calling it from a bare spec has no system to attribute the storage to, and the error
		 * is the only thing that stops two systems from silently sharing one slot.
		 *
		 * The message is pinned rather than bare: any other throw here would mean the failure moved
		 * somewhere it should not, and it is the one string the upstream package owns.
		 */
		expect(() => useChange([])).toThrow(
			"Attempt to access topologically-aware storage outside of a Loop-system context.",
		);
	});

	it("should answer true on the first frame only when there are no dependencies", () => {
		expect.assertions(4);

		const { disconnect, fire, loop } = harness();
		let changes = 0;

		loop.scheduleSystem(() => {
			if (useChange([])) {
				changes += 1;
			}
		});

		expect(changes).toBe(0);

		fire();

		expect(changes).toBe(1);

		fire();

		expect(changes).toBe(1);

		fire();

		expect(changes).toBe(1);

		disconnect();
	});

	it("should answer true once per change of a single dependency", () => {
		expect.assertions(5);

		const { disconnect, fire, loop } = harness();
		let changes = 0;
		let dependency = 0;

		loop.scheduleSystem(() => {
			if (useChange([dependency])) {
				changes += 1;
			}
		});

		fire();

		expect(changes).toBe(1);

		fire();

		expect(changes).toBe(1);

		dependency += 1;
		fire();

		expect(changes).toBe(2);

		dependency += 1;
		fire();

		expect(changes).toBe(3);

		fire();

		expect(changes).toBe(3);

		disconnect();
	});

	it("should answer true when any one of several dependencies changes", () => {
		expect.assertions(6);

		const { disconnect, fire, loop } = harness();
		let changes = 0;
		const dependencies = [0, 0, 0];

		loop.scheduleSystem(() => {
			if (useChange([...dependencies])) {
				changes += 1;
			}
		});

		fire();

		expect(changes).toBe(1);

		fire();

		expect(changes).toBe(1);

		dependencies[0] = 1;
		fire();

		expect(changes).toBe(2);

		dependencies[1] = 1;
		fire();

		expect(changes).toBe(3);

		// The frame after a change is quiet again.
		fire();

		expect(changes).toBe(3);

		dependencies[2] = 1;
		fire();

		expect(changes).toBe(4);

		disconnect();
	});
});

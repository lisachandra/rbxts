import { useMemo } from "@lisachandra/matter/hooks/useMemo";
import { describe, expect, it } from "@rbxts/jest-globals";
import Signal from "@rbxts/lemon-signal";
import { Loop, World } from "@rbxts/matter";

/*
 * Ported from the godkin repo's `shared/matter/hooks/useMemo.spec.ts` (#17 triage: rewrite).
 *
 * `useMemo` recomputes when its dependency array differs by shallow equality and otherwise returns
 * the stored value. The upstream spec also asserted that a multi-value return survives the round
 * trip — that is kept, because the implementation stores the result in a one-element array and
 * `unpack`s it, which is exactly the kind of thing a refactor to a plain field would break.
 */

function harness() {
	const loop = new Loop(new World());
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

describe("useMemo", () => {
	it("should refuse to run outside a Loop-system context", () => {
		expect.assertions(1);

		expect(() => useMemo(() => 1, [])).toThrow(
			"Attempt to access topologically-aware storage outside of a Loop-system context.",
		);
	});

	it("should call the factory once when dependencies never change", () => {
		expect.assertions(2);

		const { disconnect, fire, loop } = harness();
		let calls = 0;

		loop.scheduleSystem(() => {
			useMemo(() => {
				calls += 1;
				return calls;
			}, []);
		});

		fire();
		fire();
		fire();

		expect(calls).toBe(1);

		disconnect();

		expect(calls).toBe(1);
	});

	it("should call the factory once per dependency change", () => {
		expect.assertions(4);

		const { disconnect, fire, loop } = harness();
		let calls = 0;
		let dependency = 0;

		loop.scheduleSystem(() => {
			useMemo(() => {
				calls += 1;
				return dependency;
			}, [dependency]);
		});

		fire();

		expect(calls).toBe(1);

		fire();

		expect(calls).toBe(1);

		dependency += 1;
		fire();

		expect(calls).toBe(2);

		dependency += 1;
		fire();

		expect(calls).toBe(3);

		disconnect();
	});

	it("should return the memoized value", () => {
		expect.assertions(1);

		const { disconnect, fire, loop } = harness();
		let seen: unknown;

		loop.scheduleSystem(() => {
			seen = useMemo(() => "first", []);
		});

		fire();
		disconnect();

		expect(seen).toBe("first");
	});

	it("should return the new value after a dependency changes", () => {
		expect.assertions(2);

		const { disconnect, fire, loop } = harness();
		const seen = new Array<number>();
		let dependency = 1;

		loop.scheduleSystem(() => {
			seen.push(
				useMemo(() => {
					return dependency;
				}, [dependency]),
			);
		});

		fire();
		dependency = 2;
		fire();
		disconnect();

		expect(seen[0]).toBe(1);
		expect(seen[1]).toBe(2);
	});

	it("should return a multi-value result without collapsing it", () => {
		expect.assertions(2);

		/*
		 * The implementation stores `[callback()]` and unpacks it, which is how a callback returning a
		 * tuple survives. Storing the tuple directly would nest it one level and turn `a, b` into a
		 * single table — this is the assertion that notices.
		 */
		const { disconnect, fire, loop } = harness();
		let first: unknown;
		let second: unknown;

		loop.scheduleSystem(() => {
			const [a, b] = useMemo(() => {
				return [1, 2] as [number, number];
			}, []);
			first = a;
			second = b;
		});

		fire();
		disconnect();

		expect(first).toBe(1);
		expect(second).toBe(2);
	});
});

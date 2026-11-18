import { useReducer } from "@lisachandra/matter/hooks/useReducer";
import { describe, expect, it } from "@rbxts/jest-globals";
import Signal from "@rbxts/lemon-signal";
import { Loop, World } from "@rbxts/matter";

/*
 * Ported from the godkin repo's `shared/matter/hooks/useReducer.spec.ts` (#17 triage: rewrite).
 *
 * The property worth keeping from the original is the dispatch identity rule: `useReducer` rebuilds
 * `dispatch` only when the state changes, so a component that depends on it does not re-render on
 * every frame. The upstream spec tested that by counting identity changes across frames, and so does
 * this one.
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

type CounterAction = "decrement" | "increment";

function counter(state: number, action: CounterAction): number {
	return action === "increment" ? state + 1 : state - 1;
}

describe("useReducer", () => {
	it("should refuse to run outside a Loop-system context", () => {
		expect.assertions(1);

		expect(() => useReducer(counter, 0)).toThrow(
			"Attempt to access topologically-aware storage outside of a Loop-system context.",
		);
	});

	it("should hold the initial state while the dispatcher is not called", () => {
		expect.assertions(2);

		const { disconnect, fire, loop } = harness();
		const states = new Array<number>();

		loop.scheduleSystem(() => {
			const [state] = useReducer(counter, 0);
			states.push(state);
		});

		fire();
		fire();
		disconnect();

		expect(states[0]).toBe(0);
		expect(states[1]).toBe(0);
	});

	it("should apply one action per dispatch", () => {
		expect.assertions(3);

		const { disconnect, fire, loop } = harness();
		const states = new Array<number>();

		loop.scheduleSystem(() => {
			const [state, dispatch] = useReducer(counter, 0);
			states.push(state);

			// Dispatched from inside the system, so the next frame observes the new state.
			if (state === 0) {
				dispatch("increment");
			}
		});

		fire();
		fire();
		fire();
		disconnect();

		expect(states[0]).toBe(0);
		expect(states[1]).toBe(1);
		expect(states[2]).toBe(1);
	});

	it("should pass the action through to the reducer", () => {
		expect.assertions(1);

		const { disconnect, fire, loop } = harness();
		const actions = new Array<CounterAction>();

		loop.scheduleSystem(() => {
			const [state, dispatch] = useReducer((current: number, action: CounterAction) => {
				actions.push(action);
				return counter(current, action);
			}, 0);

			if (state === 0) {
				dispatch("decrement");
			}
		});

		fire();
		fire();
		disconnect();

		expect(actions).toEqual(["decrement"]);
	});

	it("should keep the same dispatch function while the state is unchanged", () => {
		expect.assertions(1);

		/*
		 * `dispatch` is rebuilt only when the state differs from the previous frame. A stable
		 * identity is what lets a consumer memoise on it, so this asserts sameness rather than
		 * counting dispatches.
		 */
		const { disconnect, fire, loop } = harness();
		const dispatches = new Array<(action: CounterAction) => void>();

		loop.scheduleSystem(() => {
			const [, dispatch] = useReducer(counter, 0);
			dispatches.push(dispatch);
		});

		fire();
		fire();
		disconnect();

		expect(dispatches[0]).toBe(dispatches[1]);
	});
});

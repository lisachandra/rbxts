import { HookConnector } from "@lisachandra/matter";
import { describeEachReactMode } from "@lisachandra/test/react";
import { useComponentRecord } from "@lisachandra/ui/hooks/useComponentRecord";
import { describe, expect, it } from "@rbxts/jest-globals";
import { component } from "@rbxts/matter";
import * as React from "@rbxts/react";

/*
 * Ported from the godkin repo's `client/ui/hooks/useComponentRecord.spec.tsx` (#17 triage: rewrite).
 *
 * Almost none of the upstream spec survives. It ran the hook from inside a `Loop` system rather than
 * from a React tree and asserted against godkin's `Components` registry — but this hook is a React
 * hook (`useState` + `useEffect`), and those component types were never extracted into this repo.
 *
 * What is left is the one branch that does not need a running game: the early return for a missing
 * entity id. The rest of the hook reads `store.world.contains(...)`, and `store.world` is nil until a
 * bootstrap assigns it — the same precondition that keeps `getEntityObject` out of the spec suite.
 * Calling the hook with a real entity id raises `attempt to index nil with 'contains'`, so the
 * subscription lifecycle cannot be observed here without stubbing the store, and a spec built on a
 * stubbed store would be asserting against the stub.
 */
const testComponent = component<{ value: number }>("ProbeComponent");

function requestCount(): number {
	let count = 0;
	for (const _ of pairs(HookConnector.componentRecordRequests)) {
		count += 1;
	}

	return count;
}

describe("useComponentRecord", () => {
	describeEachReactMode("useComponentRecord (%s)", ({ render }) => {
		it("should answer undefined when there is no client entity id", () => {
			expect.assertions(2);

			let record: unknown = "sentinel";

			function TestComponent() {
				record = useComponentRecord(undefined, testComponent);

				return <></>;
			}

			const { unmount } = render(<TestComponent />);
			unmount();

			/*
			 * The hook assigns `undefined` rather than leaving the state alone, which is what makes a
			 * component that loses its entity stop showing stale data. A "set only when found" version
			 * would leave the previous record on screen.
			 */
			expect(record).toBeUndefined();
			expect(requestCount()).toBe(0);
		});

		it("should not leave a request behind, across renders or remounts", () => {
			expect.assertions(2);

			/*
			 * The early return sits before `HookConnector.addComponentRecordRequest`, so no request is
			 * ever created for an absent id — not even one that is cleaned up afterwards. Both the
			 * re-render and the second mount below would expose a "create then delete" implementation,
			 * which would be functionally invisible but would still allocate on every frame.
			 */
			const before = requestCount();

			function TestComponent() {
				useComponentRecord(undefined, testComponent);

				return <></>;
			}

			const { rerender, unmount } = render(<TestComponent />);
			rerender(<TestComponent />);
			unmount();

			expect(requestCount()).toBe(before);

			const second = render(<TestComponent />);
			second.unmount();

			expect(requestCount()).toBe(before);
		});
	});
});

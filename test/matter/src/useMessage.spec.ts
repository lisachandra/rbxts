import { useMessage } from "@lisachandra/matter/hooks/useMessage";
import { describe, expect, it } from "@rbxts/jest-globals";
import Signal from "@rbxts/lemon-signal";
import { Loop, World } from "@rbxts/matter";
import type { ClientEmitter } from "@rbxts/tether/emitters/client-emitter";

/*
 * The message shape the hook infers from. `useMessage`'s return type is derived from the emitter's
 * `MessageData` map, so a loosely-typed fake would give the hook `never` to iterate — the one thing
 * that has to be concrete for the loop to typecheck.
 */
interface TestMessages {
	1: string;
	2: string;
}

/*
 * Ported from the godkin repo's `shared/matter/hooks/usePacket.spec.ts` (#17 triage: rewrite).
 *
 * The subject was renamed `usePacket` → `useMessage` and rebuilt on Tether: it no longer wraps a
 * Signal but subscribes through `emitter.on(message, listener)`. The queueing behaviour is the same,
 * and so is the rule that a message-key change tears down the old subscription.
 *
 * The fake emitter below is the seam that makes this testable without a tether transport: it records
 * listeners by key and exposes a `emit` helper to push data at them.
 */

function harness() {
	const loop = new Loop(new World());
	const event = new Signal();
	const connections = loop.begin({ default: event } as unknown as Record<
		string,
		RBXScriptSignal
	>);

	const listeners = new Map<string, Array<Callback>>();
	const emitter = {
		on(message: number | string, listener: Callback) {
			const key = tostring(message);
			const existing = listeners.get(key) ?? [];
			existing.push(listener);
			listeners.set(key, existing);

			let connected = true;
			return () => {
				if (!connected) {
					return;
				}

				connected = false;
				const current = listeners.get(key);
				if (current === undefined) {
					return;
				}

				const index = current.indexOf(listener);
				if (index !== -1) {
					current.remove(index);
				}
			};
		},
	} as unknown as ClientEmitter<TestMessages>;

	return {
		disconnect: () => {
			for (const [, connection] of pairs(connections)) {
				connection.Disconnect();
			}
		},
		emit: (message: number, ...args: Array<unknown>) => {
			for (const listener of listeners.get(tostring(message)) ?? []) {
				listener(...args);
			}
		},
		emitter,
		fire: () => {
			event.Fire();
		},
		loop,
		subscriberCount: (message: number) => (listeners.get(tostring(message)) ?? []).size(),
	};
}

describe("useMessage", () => {
	it("should refuse to run outside a Loop-system context", () => {
		expect.assertions(1);

		expect(() => useMessage({ on: () => () => {} } as never, 1)).toThrow(
			"Attempt to access topologically-aware storage outside of a Loop-system context.",
		);
	});

	it("should yield messages in the order they arrived", () => {
		expect.assertions(1);

		const { disconnect, emit, emitter, fire, loop } = harness();
		const seen = new Array<defined>();

		loop.scheduleSystem(() => {
			for (const [index, data] of useMessage(emitter, 1)) {
				seen.push([index, data]);
			}
		});

		/*
		 * The first frame is what installs the subscription: `useMessage` subscribes lazily, on its
		 * first invocation, not when the system is scheduled. Emitting before it runs would push at a
		 * listener that does not exist yet — which is exactly the bug an earlier draft of this spec
		 * had, and why it asserted zero messages.
		 */
		fire();
		emit(1, "first");
		emit(1, "second");
		fire();
		disconnect();

		expect(seen).toEqual([
			[1, "first"],
			[2, "second"],
		]);
	});

	it("should drain the queue, so a second frame yields nothing new", () => {
		expect.assertions(1);

		const { disconnect, emit, emitter, fire, loop } = harness();
		let yields = 0;

		loop.scheduleSystem(() => {
			for (const _ of useMessage(emitter, 1)) {
				yields += 1;
			}
		});

		// The first frame installs the subscription, as in the ordering spec above.
		fire();
		emit(1, "only");
		fire();
		fire();
		disconnect();

		expect(yields).toBe(1);
	});

	it("should ignore messages for a different key", () => {
		expect.assertions(1);

		const { disconnect, emit, emitter, fire, loop } = harness();
		const seen = new Array<defined>();

		loop.scheduleSystem(() => {
			for (const [, data] of useMessage(emitter, 1)) {
				seen.push(data);
			}
		});

		// The first frame installs the subscription; the stray key is rejected before it can queue.
		fire();
		emit(2, "wrong-key");
		emit(1, "right-key");
		fire();
		disconnect();

		expect(seen).toEqual(["right-key"]);
	});

	it("should unsubscribe when the message key changes", () => {
		expect.assertions(2);

		/*
		 * This is the cleanup rule the godkin spec pinned: a system that switches which message it
		 * listens for must not keep receiving the old one. `subscriberCount` is the observable —
		 * without the cleanup the old key would still hold a listener.
		 */
		const { disconnect, emitter, fire, loop, subscriberCount } = harness();
		let message = 1;

		loop.scheduleSystem(() => {
			for (const _ of useMessage(emitter, message)) {
				// Drain, so the queue does not grow across frames.
			}
		});

		fire();

		expect(subscriberCount(1)).toBe(1);

		message = 2;
		fire();

		expect(subscriberCount(1)).toBe(0);

		disconnect();
	});
});

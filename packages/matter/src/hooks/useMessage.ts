import { useHookState } from "@rbxts/matter";
import type { ClientEmitter } from "@rbxts/tether/emitters/client-emitter";
import type { ContextualEmitter } from "@rbxts/tether/emitters/contextual-emitter";
import type { ServerEmitter } from "@rbxts/tether/emitters/server-emitter";

interface Storage {
	disconnect?: () => void;
	listener: Callback;
	messageKey?: unknown;
	queue: Array<Array<unknown>>;
}

function disconnect(storage: Storage): void {
	if (!storage.disconnect) {
		return;
	}

	storage.disconnect();
	delete storage.disconnect;
}

function cleanup(storage: Storage): void {
	disconnect(storage);
	table.clear(storage);
}

type UseMessage<Emitter, Key> =
	Emitter extends ClientEmitter<infer Data>
		? Key extends keyof Data
			? [number, Data[Key]]
			: never
		: Emitter extends ServerEmitter<infer Data>
			? Key extends keyof Data
				? [number, Player, Data[Key]]
				: never
			: never;

/**
 * Creates an iterable that yields packets received from a Tether emitter.
 *
 * @remarks
 *   Uses `emitter.on(message, callback)` to subscribe. Automatically cleans up the previous
 *   subscription if the message key changes.
 * @example
 * 	```ts
 * 	// Client-side
 * 	for (const [index, data] of useMessage(myEmitter, "UpdateHealth")) {
 * 		updateHealthDisplay(data);
 * 	}
 *
 * 	// Server-side
 * 	for (const [index, player, data] of useMessage(myEmitter, "RequestHeal")) {
 * 		healPlayer(player, data.amount);
 * 	}
 * 	```;
 *
 * @param emitter - The Tether emitter to subscribe to.
 * @param message - The message key to listen for.
 * @returns An iterable function yielding message data. On client: `[index, data]`. On server:
 *   `[index, player, data]`.
 */
export function useMessage<Emitter, Key extends number>(
	emitter: Emitter,
	message: Key,
): IterableFunction<UseMessage<Emitter, Key>> {
	const key = tostring(message);
	const storage = useHookState(key, cleanup);

	if (storage.messageKey !== message) {
		if (storage.messageKey !== undefined) {
			cleanup(storage);
		}

		storage.queue = [];
		storage.messageKey = message;
		storage.listener = (...args: Array<unknown>) => {
			storage.queue.push(args);
		};

		storage.disconnect = (emitter as ContextualEmitter<unknown>).on(
			message as never,
			storage.listener,
		);
	}

	let index = 0;
	return (() => {
		index++;
		const args = storage.queue.shift();
		if (args) {
			return [index, ...args];
		}

		return undefined;
	}) as unknown as IterableFunction<UseMessage<Emitter, Key>>;
}

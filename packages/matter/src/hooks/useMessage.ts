import { useHookState } from "@rbxts/matter";
import { ClientEmitter } from "@rbxts/tether/out/emitters/client-emitter";
import { ContextualEmitter } from "@rbxts/tether/out/emitters/contextual-emitter";
import { ServerEmitter } from "@rbxts/tether/out/emitters/server-emitter";

interface Storage {
	disconnect?: () => void;
	listener: Callback;
	messageKey?: unknown;
	queue: Array<Array<unknown>>;
}

function disconnect(storage: Storage): void {
	if (storage.disconnect) {
		storage.disconnect();
		delete storage.disconnect;
	}
}

function cleanup(storage: Storage): void {
	disconnect(storage);
	table.clear(storage);
}

type UseMessage<Emitter, Key> =
    Emitter extends ClientEmitter<infer Data>
    ? (Key extends keyof Data ? [number, Data[Key]] : never)
    : Emitter extends ServerEmitter<infer Data>
    ? (Key extends keyof Data ? [number, Player, Data[Key]] : never)
    : never;

/**
 * Creates an iterable that yields packets received from a Tether emitter.
 *
 * Uses `emitter.on(message, callback)` to subscribe.
 *
 * - On client: callback receives `(data)` → yields `[index, data]`.
 * - On server: callback receives `(player, data)` → yields `[index, player, data]`.
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
		storage.listener = (...args: Array<unknown>) => storage.queue.push(args);
		storage.disconnect = (emitter as ContextualEmitter<unknown>).on(message as never, storage.listener);
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

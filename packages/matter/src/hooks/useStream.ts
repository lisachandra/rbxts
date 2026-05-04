import { useHookState } from "@rbxts/matter";
import { Workspace } from "@rbxts/services";

/**
 * Represents an event for an instance being added to the stream.
 */
export interface StreamInEvent {
	adding: true;
	descendant: boolean;
	instance: Instance;
	removing: false;
}

/**
 * Represents an event for an instance being removed from the stream.
 */
export interface StreamOutEvent {
	adding: false;
	descendant: boolean;
	instance: Instance;
	removing: true;
}

/**
 * Configuration options for the stream hook.
 */
export interface StreamOptions {
	attribute?: string;
	descendants?: boolean;
}

/**
 * A union type for stream add and remove events.
 */
export type StreamEvent = StreamInEvent | StreamOutEvent;

interface Storage {
	addedConnection: RBXScriptConnection;
	queue: Array<StreamEvent>;
	removingConnection: RBXScriptConnection;
	trackedInstances: Map<
		Instance,
		{
			addedConnection: RBXScriptConnection;
			removingConnection: RBXScriptConnection;
		}
	>;
}

type PartialStorage =
	| (Storage & { initialized: true })
	| (Partial<Storage> & { initialized?: false });

function streamInEvent(instance: Instance, descendant = false): StreamInEvent {
	return { adding: true, descendant, instance, removing: false };
}

function streamOutEvent(instance: Instance, descendant = false): StreamOutEvent {
	return { adding: false, descendant, instance, removing: true };
}

function cleanup(storage: PartialStorage): void {
	if (storage.initialized !== true) {
		return;
	}

	storage.addedConnection.Disconnect();
	storage.removingConnection.Disconnect();

	for (const [instance] of storage.trackedInstances) {
		const connections = storage.trackedInstances.get(instance);
		connections?.addedConnection.Disconnect();
		connections?.removingConnection.Disconnect();
	}
}

/**
 * Creates an iterable that yields events when instances with a matching
 * attribute are added to or removed from the workspace.
 *
 * @param id - The attribute value to match against instances.
 * @param options - Configuration options for the stream.
 * @returns An iterable function yielding `[index, StreamEvent]` tuples.
 *
 * @example
 * ```ts
 * for (const [index, event] of useStream(entityId)) {
 *     if (event.adding) {
 *         print(`Instance added: ${event.instance.Name}`);
 *     }
 * }
 * ```
 *
 * @remarks
 * Tracks descendants of matched instances when `options.descendants` is
 * `true`. Uses `Workspace.DescendantAdded` and
 * `Workspace.DescendantRemoving` signals.
 */
export function useStream(
	id: unknown,
	options: StreamOptions = {},
): IterableFunction<[number, StreamEvent]> {
	const storage = useHookState<PartialStorage>(id, cleanup);

	if (!("initialized" in storage)) {
		const attribute = options.attribute ?? "serverEntityId";
		const descendants = options.descendants ?? false;

		storage.trackedInstances = new Map();
		storage.initialized = true as never;
		storage.queue = [];

		storage.addedConnection = Workspace.DescendantAdded.Connect((instance) => {
			if (instance.GetAttribute(attribute) !== id) {
				return;
			}

			storage.queue!.push(streamInEvent(instance));

			if (!descendants || storage.trackedInstances!.has(instance)) {
				return;
			}

			storage.trackedInstances!.set(instance, {
				addedConnection: instance.DescendantAdded.Connect((descendant) => {
					storage.queue!.push(streamInEvent(descendant, true));
				}),
				removingConnection: instance.DescendantRemoving.Connect((descendant) => {
					storage.queue!.push(streamOutEvent(descendant, true));
				}),
			});

			for (const descendant of instance.GetDescendants()) {
				storage.queue!.push(streamInEvent(descendant, true));
			}
		});

		storage.removingConnection = Workspace.DescendantRemoving.Connect((instance) => {
			if (instance.GetAttribute(attribute) !== id) {
				return;
			}

			storage.queue!.push(streamOutEvent(instance));

			if (descendants) {
				for (const descendant of instance.GetDescendants()) {
					storage.queue!.push(streamOutEvent(descendant, true));
				}
			}

			const connections = storage.trackedInstances!.get(instance);
			connections?.addedConnection.Disconnect();
			connections?.removingConnection.Disconnect();
		});
	}

	let index = 0;
	return (() => {
		index++;
		const queue = storage.queue;
		if (!queue) {
			return undefined;
		}

		const value = queue.shift();
		if (value) {
			return [index, value];
		}

		return undefined;
	}) as unknown as IterableFunction<[number, StreamEvent]>;
}

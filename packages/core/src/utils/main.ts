import type { Document } from "@rbxts/lapis";
import type { Signal } from "@rbxts/lemon-signal";
import Log from "@rbxts/log";
import { Error } from "@rbxts/luau-polyfill";
import { RunService, TweenService } from "@rbxts/services";
import { promiseTree } from "@rbxts/validate-tree";

import type { CollectionData } from "../store";
import type { Character, Humanoid } from "../schemas";
import { schemas } from "../schemas";

import { type ConnectionLike, type EventLike } from "./type";

const CHARACTER_TIMEOUT = 120;
const DOCUMENT_TIMEOUT = 120;

type DocumentAccessor = (userId: number) => { document?: Document<CollectionData> };

let useDocumentAccessor: DocumentAccessor | undefined;

export function configureDocumentAccessor(accessor: DocumentAccessor): void {
	useDocumentAccessor = accessor;
}

export const tracks = new Map<Humanoid | AnimationController, Array<AnimationTrack>>();

export function lazyConnect(event: EventLike, callback: Callback): ConnectionLike {
		if (typeIs(event, "RBXScriptSignal")) {
			const connection = event.Connect((...args: Array<unknown>) => {
				if (connection.Connected) {
					callback(...args);
				}
			});
			return connection;
		}

		if ("Connect" in event) {
			return event.Connect(callback);
		}

		if ("connect" in event) {
			return event.connect(callback);
		}

		if ("subscribe" in event) {
			return event.subscribe(callback);
		}

		throw new Error(Log.Error("Event-like object does not have a supported connect method."));
}

export function lazyDisconnect(connection: ConnectionLike): void {
		if (typeIs(connection, "function")) {
			connection();
		} else if (typeIs(connection, "RBXScriptConnection") || "Disconnect" in connection) {
			connection.Disconnect();
		} else if ("disconnect" in connection) {
			connection.disconnect();
		} else {
			throw new Error(
				Log.Error("Connection-like object does not have a supported disconnect method."),
			);
		}
}

export function getHumanoid(model?: Instance, nonStrict = false): N<Humanoid> {
		if (!model) {
			return;
		}

		const character = model.IsA("Player") ? model.Character : model;
		const humanoid = character ? character.FindFirstChildOfClass("Humanoid") : undefined;

		if (!humanoid) {
			return;
		}

		if (
			!nonStrict &&
			(humanoid.GetState() === Enum.HumanoidStateType.Dead || !humanoid.RootPart)
		) {
			return;
		}

		return humanoid as Humanoid;
}

export function getInstanceWithAttribute<T extends Instance>(
		this: void,
		instances: Array<T>,
		name: string,
		value: unknown,
	): N<T> {
		for (const instance of instances) {
			if (instance.GetAttribute(name) === value) {
				return instance;
			}
		}

		return undefined;
}

export function lerpWithTransform(
		this: void,
		alphaIncrement: number,
		event: EventLike,
		transform: (alpha: number) => void,
	) {
		let alpha = 0;
		const connection = lazyConnect(event, () => {
			transform(alpha);
			alpha += alphaIncrement;
		});

		return () => {
			lazyDisconnect(connection);
		};
}

export async function loadAnimation(
		this: void,
		controller: Humanoid | AnimationController,
		animation: Animation,
	): Promise<{
		cached: boolean;
			track: AnimationTrack;
	}> {
		let controllerTracks = tracks.get(controller);
		if (!controllerTracks) {
			controllerTracks = [];
			tracks.set(controller, controllerTracks);

			const connection = controller.Destroying.Connect(() => {
				controllerTracks!.clear();
				tracks.delete(controller);
				connection.Disconnect();
			});
		}

		const trackIndex = controllerTracks.findIndex((track) => track.Animation === animation);

		if (trackIndex !== -1) {
			const track = controllerTracks[trackIndex]!;
			return {
				cached: true,
				track,
			};
		}

		const animator = controller["Animator" as never] as N<Animator>;
		assert(
			animator !== undefined,
			`loadAnimation(): Animator not found in controller! (${controller.GetFullName()})`,
		);

		const track = animator.LoadAnimation(animation);
		track.Priority =
			Enum.AnimationPriority[
				animation.GetAttribute<Enum.AnimationPriority["Name"]>("priority") ?? track.Priority.Name
			];

		controllerTracks.push(track);
		return { cached: false, track };
}

export async function loadFlag(flag: string): Promise<boolean> {
		if (!RunService.IsClient()) {
			throw new Error(Log.Error("LoadFlag() must be called from the client!"));
		}

		const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled(flag));
		return success && result;
}

export async function tween(
		this: void,
		event: EventLike,
		info: TweenInfo,
		func: (progress: number) => void,
	): Promise<void> {
		const start = os.clock();
		let resolve: () => void;

		const connection = lazyConnect(event, () => {
			const elapsed = os.clock() - start;
			if (elapsed <= info.Time) {
				func(
					TweenService.GetValue(elapsed / info.Time, info.EasingStyle, info.EasingDirection),
				);
			} else {
				resolve();
				lazyDisconnect(connection);
			}
		});

		return new Promise<void>((resolveFunc, _reject, onCancel) => {
			onCancel(() => {
				lazyDisconnect(connection);
			});

			resolve = resolveFunc;
		});
}

export async function waitForCharacter(
		this: void,
		character: Model,
		timeout = CHARACTER_TIMEOUT,
	): Promise<Character> {
		return promiseTree(character, schemas.r6Character).timeout(timeout, "Character timed out.");
}

export async function waitForDocument(
		this: void,
		userId: number,
		timeout = DOCUMENT_TIMEOUT,
	): Promise<Document<CollectionData>> {
		if (!RunService.IsServer()) {
			throw new Error(Log.Error("WaitForDocument() must be called from the server!"));
		}

		if (!useDocumentAccessor) {
			throw new Error(
				Log.Error("WaitForDocument() requires configureDocumentAccessor() before first use."),
			);
		}

		const stamp = os.time();

		while (os.time() - stamp < timeout) {
			const { document } = useDocumentAccessor(userId);
			if (document !== undefined) {
				return document;
			}

			task.wait(1);
		}

		throw new Error(Log.Error(`Document timed out for user: ${userId}`));
}

export async function waitForFirst(
		this: void,
		...signals: Array<RBXScriptSignal | Promise<defined> | Signal<Array<defined>>>
	): Promise<defined> {
		const slots = signals.map((signal) => {
			return Promise.is(signal)
				? signal
				: new Promise<defined>((resolve, _reject, onCancel) => {
					const promise = Promise.fromEvent(signal);
					onCancel(() => {
						promise.cancel();
					});
					resolve([promise.expect()]);
				});
		});
		return Promise.race(slots) as Promise<defined>;
}

export function catcher(err: object): void {
		Log.Warn(debug.traceback(`\n${tostring(err)}`));
}

export function applyHumanoidDescription(
		this: void,
		humanoid: Humanoid,
		description: HumanoidDescription,
	): void {
		humanoid.ApplyDescriptionReset(description);
		if (humanoid.RootPart) {
			humanoid.RootPart.Transparency = 1;
		}

		const pants = humanoid.Parent.FindFirstChildOfClass("Pants");
		const shirt = humanoid.Parent.FindFirstChildOfClass("Shirt");

		if (pants) {
			pants.PantsTemplate = `rbxassetid://${description.Pants}`;
		}

		if (shirt) {
			shirt.ShirtTemplate = `rbxassetid://${description.Shirt}`;
		}
}

const trackGcInterval = 5;

if (!(_G.__TEST__ ?? false)) {
	task.spawn(() => {
		while (task.wait(trackGcInterval) as never) {
			for (const [controller] of tracks) {
				if (controller.IsDescendantOf(game)) {
					continue;
				}

				tracks.delete(controller);
			}
		}
	});
}

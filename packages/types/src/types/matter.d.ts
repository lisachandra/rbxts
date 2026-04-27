import type { SystemFn } from "@rbxts/matter";

declare module "@rbxts/matter" {
	interface SystemStruct<T extends Array<unknown>> {
		after?: Array<SystemFn<T> | SystemStruct<T>>;
		placeIds?: Array<number>;
		priority?: number;
		system: SystemFn<T>;
		phase?:
			| "Hz1"
			| "Hz5"
			| "Hz10"
			| "Hz15"
			| "Hz30"
			| "Hz60"
			| "stepped"
			| "heartbeat"
			| "preRender"
			| "renderLast"
			| "renderFirst"
			| "renderInput"
			| "preAnimation"
			| "renderCamera"
			| "renderStepped"
			| "preSimulation"
			| "postSimulation"
			| "renderCharacter"
			| "playerModuleCamera";
	}

	interface World {
		startDeferring(): void;
		stopDeferring(): void;
	}
}

export {};

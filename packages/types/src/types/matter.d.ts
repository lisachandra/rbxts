import type { SystemFn } from "@rbxts/matter";

declare module "@rbxts/matter" {
	export type RenderPriorityPhase =
		| "renderLast"
		| "renderFirst"
		| "renderInput"
		| "renderCamera"
		| "renderCharacter";
	export type Phases =
		| "default"
		| "stepped"
		| "heartbeat"
		| "preRender"
		| "preAnimation"
		| "preSimulation"
		| "renderStepped"
		| "postSimulation"
		| RenderPriorityPhase
		| "playerModuleCamera";

	interface SystemStruct<T extends Array<unknown>> {
		after?: Array<SystemFn<T> | SystemStruct<T>>;
		phase?: Phases;
		placeIds?: Array<number>;
		priority?: number;
		system: SystemFn<T>;
	}

	interface World {
		startDeferring(): void;
		stopDeferring(): void;
	}
}

export {};

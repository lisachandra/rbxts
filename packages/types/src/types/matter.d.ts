import type { SystemFn } from "@rbxts/matter";

declare module "@rbxts/matter" {
	export type SimulationPhase = Enum.StepFrequency["Name"];
	export type RenderPriorityPhase =
		| "renderCamera"
		| "renderCharacter"
		| "renderFirst"
		| "renderInput"
		| "renderLast";
	export type Phases =
		| "default"
		| "heartbeat"
		| "postSimulation"
		| "preAnimation"
		| "preRender"
		| "preSimulation"
		| "stepped"
		| "renderStepped"
		| SimulationPhase
		| RenderPriorityPhase
		| "playerModuleCamera";

	interface SystemStruct<T extends Array<unknown>> {
		after?: Array<SystemFn<T> | SystemStruct<T>>;
		placeIds?: Array<number>;
		priority?: number;
		system: SystemFn<T>;
		phase?: Phases;
	}

	interface World {
		startDeferring(): void;
		stopDeferring(): void;
	}
}

export {};

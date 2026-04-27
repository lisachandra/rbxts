import Signal from "@rbxts/lemon-signal";
import { RunService, Workspace } from "@rbxts/services";
import { iterate } from "@lisachandra/core/out/utils/type";

export type SimulationPhaseName = Enum.StepFrequency["Name"];
export type RenderPriorityPhaseName =
	| "renderCamera"
	| "renderCharacter"
	| "renderFirst"
	| "renderInput"
	| "renderLast";
export type MatterPhaseName =
	| "default"
	| "heartbeat"
	| "postSimulation"
	| "preAnimation"
	| "preRender"
	| "preSimulation"
	| "stepped"
	| "renderStepped"
	| SimulationPhaseName
	| RenderPriorityPhaseName
	| "playerModuleCamera";

export const customPhases = {
	playerModuleCamera: new Signal(),
};

/* eslint-disable ts/naming-convention -- Roblox enum naming */
export const bindSimulationPhaseEvents: Record<SimulationPhaseName, RBXScriptSignal> = {
	Hz1: new Signal() as never as RBXScriptSignal,
	Hz5: new Signal() as never as RBXScriptSignal,
	Hz10: new Signal() as never as RBXScriptSignal,
	Hz15: new Signal() as never as RBXScriptSignal,
	Hz30: new Signal() as never as RBXScriptSignal,
	Hz60: new Signal() as never as RBXScriptSignal,
};
/* eslint-enable ts/naming-convention */

export const renderPriorityPhaseEvents: Record<RenderPriorityPhaseName, RBXScriptSignal> = {
	renderCamera: new Signal() as never as RBXScriptSignal,
	renderCharacter: new Signal() as never as RBXScriptSignal,
	renderFirst: new Signal() as never as RBXScriptSignal,
	renderInput: new Signal() as never as RBXScriptSignal,
	renderLast: new Signal() as never as RBXScriptSignal,
};

export const priorityByRenderPhase: Record<RenderPriorityPhaseName, number> = {
	renderCamera: Enum.RenderPriority.Camera.Value,
	renderCharacter: Enum.RenderPriority.Character.Value,
	renderFirst: Enum.RenderPriority.First.Value,
	renderInput: Enum.RenderPriority.Input.Value,
	renderLast: Enum.RenderPriority.Last.Value,
};

if (RunService.IsClient()) {
	for (const [phase, event] of iterate(renderPriorityPhaseEvents)) {
		const priority = priorityByRenderPhase[phase];
		RunService.BindToRenderStep(`${phase}SystemEvent`, priority - 1, () => {
			const stepSystemsConnection =
				(event as unknown as { _head: false | { _fn: Callback } })._head;
			if (typeIs(stepSystemsConnection, "table")) {
				stepSystemsConnection._fn();
			}
		});
	}
}

// @ts-expect-error -- type defs may miss UseFixedSimulation
if (pcall(() => Workspace.UseFixedSimulation as boolean)[0]) {
	for (const [phase, event] of iterate(bindSimulationPhaseEvents)) {
		RunService.BindToSimulation(() => {
			const stepSystemsConnection = (event as never as { _head: false | { _fn: Callback } })
				._head;
			if (typeIs(stepSystemsConnection, "table")) {
				stepSystemsConnection._fn();
			}
		}, phase);
	}
}

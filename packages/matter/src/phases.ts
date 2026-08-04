import { iterate } from "@lisachandra/core/utils/type";
import Signal from "@rbxts/lemon-signal";
import type { RenderPriorityPhase } from "@rbxts/matter";
import { RunService } from "@rbxts/services";

export const customPhases = {
	playerModuleCamera: new Signal(),
};

export const renderPriorityPhaseEvents: Record<RenderPriorityPhase, RBXScriptSignal> = {
	renderCamera: new Signal() as never as RBXScriptSignal,
	renderCharacter: new Signal() as never as RBXScriptSignal,
	renderFirst: new Signal() as never as RBXScriptSignal,
	renderInput: new Signal() as never as RBXScriptSignal,
	renderLast: new Signal() as never as RBXScriptSignal,
};

export const priorityByRenderPhase: Record<RenderPriorityPhase, number> = {
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
			const stepSystemsConnection = (event as unknown as { _head: false | { _fn: Callback } })
				._head;
			if (typeIs(stepSystemsConnection, "table")) {
				stepSystemsConnection._fn();
			}
		});
	}
}

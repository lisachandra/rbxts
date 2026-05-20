import { AppContext, useComponentRecord } from "@lisachandra/ui";
import { getComponent } from "@lisachandra/matter";
import React, { useContext } from "@rbxts/react";
import type { JSX } from "@rbxts/react";
import { useLocalClientEntityId } from "client/ui/hooks/useDemoEntities";

export function ResourceBar(): JSX.Element {
	const { px } = useContext(AppContext);
	const entityId = useLocalClientEntityId();
	const carryRecord = useComponentRecord(entityId, getComponent("CarryState"));
	const promptRecord = useComponentRecord(entityId, getComponent("PromptState"));
	const carry = carryRecord?.new ?? carryRecord?.old;
	const prompt = promptRecord?.new ?? promptRecord?.old;

	return (
		<frame BackgroundColor3={Color3.fromRGB(31, 48, 35)} BackgroundTransparency={0.15} Size={UDim2.fromOffset(px(280), px(100))}>
			<uicorner CornerRadius={new UDim(0, px(10))} />
			<uilistlayout FillDirection="Vertical" Padding={new UDim(0, px(6))} />
			<textlabel BackgroundTransparency={1} Font={Enum.Font.GothamBold} Size={UDim2.fromOffset(px(260), px(24))} Text="Carrying" TextColor3={Color3.fromRGB(255, 255, 255)} TextSize={px(18)} />
			<textlabel BackgroundTransparency={1} Font={Enum.Font.Gotham} Size={UDim2.fromOffset(px(260), px(22))} Text={`${carry?.kind ?? "Nothing"} x${tostring(carry?.amount ?? 0)}`} TextColor3={Color3.fromRGB(227, 235, 222)} TextSize={px(16)} />
			<textlabel BackgroundTransparency={1} Font={Enum.Font.Gotham} Size={UDim2.fromOffset(px(260), px(22))} Text={`Nearby Task: ${prompt?.text ?? "Walk near a pickup."}`} TextColor3={Color3.fromRGB(196, 220, 173)} TextSize={px(14)} TextWrapped={true} />
		</frame>
	);
}

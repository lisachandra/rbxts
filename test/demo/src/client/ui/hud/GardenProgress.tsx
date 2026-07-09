import { AppContext, useComponentRecord } from "@lisachandra/ui";
import { Components} from "@lisachandra/matter";
import React, { useContext } from "@rbxts/react";
import type { JSX } from "@rbxts/react";
import { useGardenProgressEntityId } from "client/ui/hooks/useDemoEntities";

export function GardenProgress(): JSX.Element {
	const { px } = useContext(AppContext);
	const entityId = useGardenProgressEntityId();
	const progressRecord = useComponentRecord(entityId, Components.GardenProgress);
	const progress = progressRecord?.new ?? progressRecord?.old;

	return (
		<frame BackgroundColor3={Color3.fromRGB(26, 60, 35)} BackgroundTransparency={0.1} Size={UDim2.fromOffset(px(240), px(110))}>
			<uicorner CornerRadius={new UDim(0, px(10))} />
			<uilistlayout FillDirection="Vertical" Padding={new UDim(0, px(6))} />
			<textlabel BackgroundTransparency={1} Font={Enum.Font.GothamBold} Size={UDim2.fromOffset(px(220), px(24))} Text="Garden Health" TextColor3={Color3.fromRGB(255, 255, 255)} TextSize={px(18)} />
			<textlabel BackgroundTransparency={1} Font={Enum.Font.Gotham} Size={UDim2.fromOffset(px(220), px(22))} Text={`${tostring(progress?.health ?? 0)}%`} TextColor3={Color3.fromRGB(157, 255, 155)} TextSize={px(16)} />
			<textlabel BackgroundTransparency={1} Font={Enum.Font.Gotham} Size={UDim2.fromOffset(px(220), px(22))} Text={`Restored Plots: ${tostring(progress?.restoredPlots ?? 0)}/${tostring(progress?.totalPlots ?? 0)}`} TextColor3={Color3.fromRGB(230, 236, 217)} TextSize={px(14)} />
			<textlabel BackgroundTransparency={1} Font={Enum.Font.Gotham} Size={UDim2.fromOffset(px(220), px(22))} Text={`Harvested: ${tostring(progress?.harvested ?? 0)}`} TextColor3={Color3.fromRGB(255, 221, 138)} TextSize={px(14)} />
		</frame>
	);
}

import { AppContext } from "@lisachandra/ui";
import React, { useContext } from "@rbxts/react";
import type { JSX } from "@rbxts/react";

import { GardenProgress } from "./GardenProgress";
import { ResourceBar } from "./ResourceBar";

export function GardenHud(): JSX.Element {
	const { px } = useContext(AppContext);

	return (
		<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
			<frame
				BackgroundTransparency={1}
				Position={UDim2.fromOffset(px(16), px(16))}
				Size={UDim2.fromOffset(px(260), px(120))}
			>
				<GardenProgress />
			</frame>
			<frame
				AnchorPoint={new Vector2(1, 0)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(1, 0).add(UDim2.fromOffset(-px(16), px(16)))}
				Size={UDim2.fromOffset(px(300), px(120))}
			>
				<ResourceBar />
			</frame>
		</frame>
	);
}

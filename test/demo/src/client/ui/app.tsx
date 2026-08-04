import { Router } from "@lisachandra/react-router";
import type { AppContextObject } from "@lisachandra/ui";
import { AppContext, usePx } from "@lisachandra/ui";
import { useViewport } from "@rbxts/pretty-react-hooks";
import React, { useBinding, useMemo } from "@rbxts/react";
import type { JSX } from "@rbxts/react";

import { GardenHud } from "./hud/GardenHud";
import { GardenNotifications } from "./notifications/GardenNotifications";
import { WorldMarkers } from "./overlays/WorldMarkers";

export function App(): JSX.Element {
	const viewport = useViewport();
	const px = usePx(viewport);
	const [screen, _setScreenSize] = useBinding(Vector2.one);

	const contextValue = useMemo<AppContextObject>(() => {
		return { px, screen, viewport };
	}, [px, screen, viewport]);

	return (
		<Router>
			<AppContext.Provider value={contextValue}>
				<screengui
					DisplayOrder={1}
					Enabled={true}
					IgnoreGuiInset={true}
					ResetOnSpawn={false}
					ZIndexBehavior="Global"
				>
					<GardenHud />
					<GardenNotifications />
					<WorldMarkers />
				</screengui>
			</AppContext.Provider>
		</Router>
	);
}

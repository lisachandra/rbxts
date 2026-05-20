/*
 * This component serves as the entry point for the client-side UI system. It
 * sets up the global application context, initializes core UI components, and
 * ensures consistent scaling and positioning of elements across devices.
 */
import { Router } from "@lisachandra/react-router";
import { AppContext, AppContextObject, usePx } from "@lisachandra/ui";
import { useViewport } from "@rbxts/pretty-react-hooks";
import React, { useBinding, useMemo } from "@rbxts/react";
import type { JSX } from "@rbxts/react";

/*
 * The root component for the application. Sets up the context (`AppContext`)
 * and initializes various UI components. Ensures proper scaling of elements.
 */
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
				></screengui>
			</AppContext.Provider>
		</Router>
	);
}

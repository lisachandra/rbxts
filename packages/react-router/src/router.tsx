import type { JSX, ReactNode } from "@rbxts/react";
import React, { useEffect, useMemo, useRef, useState } from "@rbxts/react";

import { History } from "./history";
import { RouterContext } from "./routerContext";

/**
 * Root router component that provides history and location state to all descendant route matchers.
 *
 * @example
 * 	```tsx
 * 	<Router>
 * 		<App />
 * 	</Router>;
 * 	```;
 *
 * @param children - Nested route components.
 * @returns A React element wrapping children in a {@link RouterContext}.
 */
export function Router({
	children,
	history,
}: Readonly<{ children?: ReactNode; history?: History }>): JSX.Element {
	const historyRef = useRef(history ?? new History());
	const [location, setLocation] = useState(historyRef.current.location);
	const contextValue = useMemo(() => {
		return {
			history: historyRef.current,
			location,
		};
	}, [location]);

	useEffect(() => {
		const listener = historyRef.current.onChanged.Connect(() => {
			setLocation(historyRef.current.location);
		});

		return () => {
			listener.Disconnect();
		};
	}, []);

	return <RouterContext.Provider value={contextValue}>{children}</RouterContext.Provider>;
}

import type { ReactNode, JSX } from "@rbxts/react";
import React, { useEffect, useMemo, useRef, useState } from "@rbxts/react";

import { History } from "./history";
import { RouterContext } from "./routerContext";

/**
 * Root router component that provides history and location state to all
 * descendant route matchers.
 *
 * @param children - Nested route components.
 * @param history - Optional custom history instance. Creates a default one if
 *   omitted.
 *
 * @returns A React element wrapping children in a {@link RouterContext}.
 *
 * @example
 * ```tsx
 * <Router><App /></Router>
 * ```
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

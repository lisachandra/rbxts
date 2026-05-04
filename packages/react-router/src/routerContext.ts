import { createContext } from "@rbxts/react";

import type { History, HistoryEntry } from "./history";

interface RouterContext {
	history: History;
	location: HistoryEntry;
}

/**
 * React context that provides the current {@link History} instance and
 * the active {@link HistoryEntry | location} to descendant components.
 */
export const RouterContext = createContext<RouterContext>({} as RouterContext);

import { useContext } from "@rbxts/react";

import { RouterContext } from "./routerContext";

type GetContext<T> = T extends React.Context<infer U> ? U : never;

/**
 * Retrieves the router context value containing the current
 * {@link History} and {@link HistoryEntry | location}.
 *
 * @returns The router context or an empty object if no provider is
 *   mounted above.
 */
export function useRouter(): GetContext<typeof RouterContext> {
	return useContext(RouterContext);
}

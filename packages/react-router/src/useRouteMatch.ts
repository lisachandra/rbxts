import { useMemo } from "@rbxts/react";

import type { PathMatchOptions, PathMatchResults } from "./path";
import { Path } from "./path";
import { useRouter } from "./useRouter";

/**
 * Options passed to {@link useRouteMatch}.
 *
 * Extends {@link PathMatchOptions} with a required `path` pattern.
 *
 * @param path - The path pattern (e.g. `"/users/:id"`) to match
 *   against the current URL.
 */
export interface RouteMatchOptions extends PathMatchOptions {
	path: string;
}

/**
 * Returns named path-parameter captures if the current location
 * matches the provided pattern, or `undefined` otherwise.
 *
 * @param routeMatchOptions - The path pattern and match options.
 *
 * @returns A record of capture-name → value, or `undefined` when
 *   there is no match.
 *
 * @example
 * ```ts
 * const match = useRouteMatch({ path: "/users/:userId" });
 * if (match) {
 *   print(match.userId);
 * }
 * ```
 */
export function useRouteMatch(routeMatchOptions: RouteMatchOptions): undefined | PathMatchResults {
	const options = routeMatchOptions ?? { path: routeMatchOptions };

	const path = useMemo(() => new Path(options.path), [options.path]);
	const router = useRouter();

	return path.match(router.location.path, options);
}

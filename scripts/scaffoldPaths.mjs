/*
 * The container predicates the emulator scaffold relies on, as data.
 *
 * `scripts/luau/scaffoldContainers.luau` decides which folders to bundle, and
 * `scripts/scaffoldCoverage.test.mjs` asserts that every such folder actually got a bundle. The two
 * are written in different languages against the same project file, so a drift between them would be
 * silent: either the scaffold stops making something the check still expects, or the check stops
 * noticing something the scaffold stopped making. These functions are the definition both sides
 * agree on, and the test imports them rather than re-deriving the rule.
 */

/** Rojo marks its own directives with a `$` prefix. */
function isDirective(key) {
	return key.startsWith("$");
}

/**
 * A folder the staging step will not create, so a bundle has to.
 *
 * @param node - One node of a Rojo project tree.
 * @returns True for a literal `Folder` with no `$path` mount of its own.
 */
export function isContainer(node) {
	return (
		node !== null &&
		typeof node === "object" &&
		node.$className === "Folder" &&
		node.$path === undefined
	);
}

/**
 * Whether a subtree carries a `$path` mount anywhere below it.
 *
 * @param node - One node of a Rojo project tree.
 * @returns True when the node or any descendant is a mount.
 * @remarks A folder whose subtree has mounts is a mount parent (`ReplicatedStorage.TS`): the stage
 *   builds it to hold them, so scaffolding an empty twin would shadow the real one.
 */
export function containsMount(node) {
	if (node === null || typeof node !== "object") {
		return false;
	}

	if (node.$path !== undefined) {
		return true;
	}

	return Object.entries(node).some(([key, child]) => !isDirective(key) && containsMount(child));
}

/**
 * Every folder in a project that the scaffold is responsible for creating.
 *
 * @param project - A parsed `default.project.json`.
 * @returns Dotted paths, parents before children.
 */
export function scaffoldedContainers(project) {
	/** @type {Array<{ path: string }>} */
	const found = [];

	/**
	 * Records every scaffold-eligible folder below `node`, descending through the rest.
	 *
	 * @param node - One node of a Rojo project tree.
	 * @param pathParts - The path segments of `node` from the tree root.
	 */
	const walk = (node, pathParts) => {
		for (const [key, child] of Object.entries(node)) {
			if (typeof child !== "object" || child === null || isDirective(key)) {
				continue;
			}

			const childPath = [...pathParts, key];
			/*
			 * Record the folder, then descend whether or not it is one. A service — `ReplicatedStorage`,
			 * whose `$className` is not `Folder` — is not itself scaffolded, but its children are, and
			 * the scaffold's own builder descends the same way.
			 */
			if (isContainer(child) && !containsMount(child)) {
				found.push({ path: childPath.join(".") });
			}

			walk(/** @type {Record<string, unknown>} */ (child), childPath);
		}
	};

	if (project !== null && typeof project === "object" && project.tree !== undefined) {
		walk(/** @type {Record<string, unknown>} */ (project.tree), []);
	}

	return found;
}

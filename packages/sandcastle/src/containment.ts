/*
 * Path containment: the one place that answers "is this inside a directory the runner owns?".
 *
 * The runner creates, merges, and recursively deletes directories, and the question used to be
 * answered — or not asked — at each call site. One unchecked manifest field could therefore reach a
 * recursive delete: a recorded `worktree` of `C:/Windows` resolved to `C:\Windows` because an absolute
 * path replaces the root in `path.resolve`, and a name of `../../evil` escaped the state root through
 * four separate sinks.
 *
 * The predicate is deliberately pure. It resolves and case-folds, but never touches the filesystem, so
 * the whole property is a table test. A symlink that points out of the root passes: closing that needs
 * `realpath` and a decision about non-existent targets, which is a separate change.
 */

import { relative as pathRelative, resolve as pathResolve } from "node:path";

import { normalizedPath } from "./runtime.js";

/**
 * Whether `candidate` resolves to a path strictly inside `root`.
 *
 * @remarks
 *   Equality does not count. A caller asking this question is about to write to or delete the path,
 *   and the root is a directory the runner populated — deleting the root itself is never the
 *   intent, and permitting it would make `within(root, root)` a way to delete everything. The
 *   comparison is on the relative path rather than a string prefix: `/a/bc` must not read as inside
 *   `/a/b`, which a prefix test gets wrong. Case folding happens in {@link normalizedPath}, so a
 *   Windows drive-letter case difference does not decide the answer.
 * @param root - The directory the caller owns.
 * @param candidate - The path being checked, absolute or relative to the working directory.
 * @returns True when `candidate` is below `root`; false when it is `root` itself or outside it.
 */
export function within(root: string, candidate: string): boolean {
	const rootPath = normalizedPath(root);
	const candidatePath = normalizedPath(candidate);
	if (rootPath === candidatePath) {
		return false;
	}

	const relativePath = pathRelative(rootPath, candidatePath);

	/*
	 * `path.relative` answers with `..` segments for anything outside, and with an absolute path when
	 * the two are on different drives (Windows), where no relative answer exists.
	 */
	if (
		relativePath === "" ||
		relativePath.startsWith("..") ||
		pathResolve(rootPath, relativePath) !== candidatePath
	) {
		return false;
	}

	return true;
}

/**
 * Returns `candidate` when it is contained, throwing a refusal that names both paths otherwise.
 *
 * @param root - The directory the caller owns.
 * @param candidate - The path being checked.
 * @param what - What the path is, for the message, e.g. `"worktree"`.
 * @returns `candidate`, unchanged, so a call site can build and check in one expression.
 * @throws {Error} When the path is not strictly inside `root`.
 */
export function assertWithin(root: string, candidate: string, what = "path"): string {
	if (!within(root, candidate)) {
		throw new Error(
			`Refusing to touch ${what} ${JSON.stringify(candidate)}: it is not inside ${JSON.stringify(root)}.`,
		);
	}

	return candidate;
}

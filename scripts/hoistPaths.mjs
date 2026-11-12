/*
 * The path predicates `hoist.mjs` deletes and links with.
 *
 * Split out from the entry point so they can be tested without running a sync: a spec should not
 * have to import a script that spawns `pnpm list` at module load, and `no-exports-in-scripts` is
 * right that an entry point should not be a library. Nothing here touches the filesystem except
 * {@link removePath}, whose whole job is the containment check.
 */

import fs from "node:fs";
import path from "node:path";

function pathExists(targetPath) {
	try {
		fs.lstatSync(targetPath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Folds a path to a form two paths can be compared in.
 *
 * @param targetPath - The path to normalize.
 * @returns The normalized, trailing-separator-free, lower-cased path.
 * @remarks Case is folded because this is Windows-first tooling.
 */
export function normalizeForComparison(targetPath) {
	return path
		.normalize(targetPath)
		.replace(/[\\/]+$/u, "")
		.toLowerCase();
}

/**
 * Whether `candidate` lies strictly inside `root`.
 *
 * Both are resolved before comparison, so a path carrying `..` cannot pass by spelling. The
 * separator boundary is the point: `/a/bc` is not inside `/a/b`, which a bare `startsWith` would
 * claim.
 *
 * @param root - Directory that must contain the candidate.
 * @param candidate - Path to test; it need not exist.
 * @returns `true` when the candidate is inside the root.
 */
export function isWithin(root, candidate) {
	const normalizedRoot = normalizeForComparison(path.resolve(root));
	const normalizedCandidate = normalizeForComparison(path.resolve(candidate));
	if (normalizedCandidate === normalizedRoot) {
		return false;
	}

	return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep.toLowerCase()}`);
}

/**
 * Quotes a path so `cmd.exe` cannot re-parse it into a second command.
 *
 * Two things have to be true at once, and either alone is broken (both verified against the real
 * `cmd.exe`):
 *
 * - The argument must reach `cmd` already quoted, because `cmd.exe /c` re-parses everything after
 *   `/c` and treats `&` as a command separator. A directory named `a&calc&b` otherwise produced
 *   `'b' is not recognized as an internal or external command`.
 * - Node must not re-quote it. `execFileSync` applies C-runtime argument quoting to any argument
 *   containing a quote or space, which turns `"C:\a b"` into `"\"C:\a b\""` and makes `mklink` answer
 *   "The filename, directory name, or volume label syntax is incorrect." So the caller passes
 *   `windowsVerbatimArguments: true` alongside this, which sends the string through untouched.
 *
 * Inside double quotes `cmd` treats `&`, `|`, `<`, `>` and `^` literally, so no escaping is applied:
 * doubling the caret would put a second caret in the created directory name, which was also
 * verified. (`|`, `<` and `>` are illegal in a Windows filename regardless; quoting does not make
 * them legal, it only stops them splitting the command.).
 *
 * @param targetPath - The path to pass to a `cmd.exe` command.
 * @returns The argument to hand to `execFileSync` with `windowsVerbatimArguments: true`.
 */
export function quoteForCommand(targetPath) {
	return `"${targetPath}"`;
}

/**
 * Deletes a path, but only inside the root the caller owns.
 *
 * Containment is the point: `rmSync(recursive)` on a path that escaped its root is the difference
 * between clearing a staging entry and emptying the repository. The check runs before the kind of
 * path is considered, so an escaping target is refused whether or not it exists.
 *
 * @param targetPath - Path to remove.
 * @param root - Directory that must contain the target.
 * @throws {Error} When the target resolves outside the root.
 */
export function removePath(targetPath, root) {
	if (!isWithin(root, targetPath)) {
		throw new Error(
			`Refusing to delete ${targetPath}: it is outside ${root}. A package field resolved past its own directory.`,
		);
	}

	if (!pathExists(targetPath)) {
		return;
	}

	fs.rmSync(targetPath, { force: true, recursive: true });
}

/**
 * Normalizes a package-relative path from `main` / `types` / `module` / `files[]`.
 *
 * The containment test is on the **resolved** path, not the spelling. A prefix check for `../` sees
 * `../x` but not `src/../../..`, and `path.join` collapses that to a directory above the package —
 * which the staging delete then recursively removes. Rejecting anything whose resolution escapes the
 * package subsumes the prefix check and catches the interior case.
 *
 * @param value - The raw field value.
 * @param packageDirectory - Absolute directory the path is relative to.
 * @returns The normalized path, or nothing when it is not a safe relative path.
 */
export function normalizePackageRelativePath(value, packageDirectory) {
	if (typeof value !== "string") {
		return undefined;
	}

	if (value.length === 0) {
		return undefined;
	}

	if (value.includes("*")) {
		return undefined;
	}

	if (path.isAbsolute(value)) {
		return undefined;
	}

	const normalized = value.startsWith("./") ? value.slice(2) : value;
	if (normalized.length === 0) {
		return undefined;
	}

	/*
	 * Resolve against the package root and compare with a separator boundary: `src/../..` resolves
	 * to the package's parent, and `src/**` (already rejected above) is the only legitimate glob.
	 */
	if (!isWithin(packageDirectory, path.resolve(packageDirectory, normalized))) {
		return undefined;
	}

	return normalized;
}

/**
 * Collects every string leaf that names a package-relative path.
 *
 * @param value - The field value (a string, an array, or a nested map).
 * @param output - Paths accumulated so far.
 * @param packageDirectory - Absolute directory the paths are relative to.
 */
function collectStringLeafPaths(value, output, packageDirectory) {
	if (typeof value === "string") {
		const normalized = normalizePackageRelativePath(value, packageDirectory);
		if (normalized) {
			output.add(normalized);
		}

		return;
	}

	if (!value || typeof value !== "object") {
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectStringLeafPaths(item, output, packageDirectory);
		}

		return;
	}

	for (const nestedValue of Object.values(value)) {
		collectStringLeafPaths(nestedValue, output, packageDirectory);
	}
}

/**
 * - The set of package-relative paths to stage for one workspace package.
 * - @param packageJson The package's manifest.
 * - @param packageDirectory Absolute directory of the package.
 * - @returns Sorted, de-duplicated relative paths, each proven to resolve inside the package.
 * - @remarks Every field goes through the same resolved containment test, so a `main` of
 *   `src/../../..` is dropped here rather than reaching a delete.
 */
export function getStageEntriesForPackage(packageJson, packageDirectory) {
	const entries = new Set(["package.json"]);
	const directFields = [
		packageJson.main,
		packageJson.module,
		packageJson.types,
		packageJson.typings,
	];
	for (const field of directFields) {
		const normalized = normalizePackageRelativePath(field, packageDirectory);
		if (normalized) {
			entries.add(normalized);
		}
	}

	if (Array.isArray(packageJson.files)) {
		for (const fileEntry of packageJson.files) {
			const normalized = normalizePackageRelativePath(fileEntry, packageDirectory);
			if (normalized) {
				entries.add(normalized);
			}
		}
	}

	collectStringLeafPaths(packageJson.exports, entries, packageDirectory);
	collectStringLeafPaths(packageJson.bin, entries, packageDirectory);

	return [...entries].sort();
}

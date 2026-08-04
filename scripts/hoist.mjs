#!/usr/bin/env node

/* oxlint-disable eslint/max-lines-per-function, eslint/max-lines -- Hoist script */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hoistScriptPath = fileURLToPath(import.meta.url);
const hoistScriptDirectory = path.dirname(hoistScriptPath);
const rootDirectory = path.resolve(hoistScriptDirectory, "..");
const npmrcPath = path.join(rootDirectory, ".npmrc");
const pnpmWorkspaceYamlPath = path.join(rootDirectory, "pnpm-workspace.yaml");
const workspaceLinksRoot = path.join(rootDirectory, ".workspace-links");
const rootNodeModules = path.join(rootDirectory, "node_modules");
const verbose = process.env.HOIST_VERBOSE === "1";

function pathExists(targetPath) {
	try {
		fs.lstatSync(targetPath);
		return true;
	} catch {
		return false;
	}
}

function normalizeForComparison(targetPath) {
	return path
		.normalize(targetPath)
		.replace(/[\\/]+$/u, "")
		.toLowerCase();
}

function resolvesOutsideSelf(targetPath) {
	if (!pathExists(targetPath)) {
		return false;
	}

	try {
		const resolvedPath = fs.realpathSync.native(targetPath);
		return (
			normalizeForComparison(resolvedPath) !==
			normalizeForComparison(path.resolve(targetPath))
		);
	} catch {
		return false;
	}
}

function tryRealpath(targetPath) {
	try {
		return fs.realpathSync.native(targetPath);
	} catch {
		return undefined;
	}
}

function getLinkSourcePath(sourcePath) {
	return tryRealpath(sourcePath) ?? path.resolve(sourcePath);
}

function ensureDirectory(targetPath) {
	fs.mkdirSync(targetPath, { recursive: true });
}

function removePath(targetPath) {
	if (!pathExists(targetPath)) {
		return;
	}

	fs.rmSync(targetPath, { force: true, recursive: true });
}

function ensureLink(sourcePath, targetPath) {
	ensureDirectory(path.dirname(targetPath));

	if (pathExists(targetPath)) {
		const existingResolvedPath = tryRealpath(targetPath);
		const sourceResolvedPath = tryRealpath(sourcePath) ?? path.resolve(sourcePath);
		if (
			existingResolvedPath !== undefined &&
			normalizeForComparison(existingResolvedPath) ===
				normalizeForComparison(sourceResolvedPath)
		) {
			return;
		}

		removePath(targetPath);
	}

	const linkSourcePath = getLinkSourcePath(sourcePath);
	const stats = fs.statSync(linkSourcePath);

	try {
		if (process.platform === "win32" && stats.isDirectory()) {
			execFileSync("cmd.exe", ["/c", "mklink", "/J", targetPath, linkSourcePath], {
				stdio: ["ignore", "ignore", "pipe"],
			});
		} else {
			fs.symlinkSync(linkSourcePath, targetPath, stats.isDirectory() ? "dir" : "file");
		}
	} catch (err) {
		if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
			removePath(targetPath);
			if (process.platform === "win32" && stats.isDirectory()) {
				execFileSync("cmd.exe", ["/c", "mklink", "/J", targetPath, linkSourcePath], {
					stdio: ["ignore", "ignore", "pipe"],
				});
			} else {
				fs.symlinkSync(linkSourcePath, targetPath, stats.isDirectory() ? "dir" : "file");
			}

			return;
		}

		throw err;
	}
}

function ensureCopiedFile(sourcePath, targetPath) {
	removePath(targetPath);
	ensureDirectory(path.dirname(targetPath));
	fs.copyFileSync(sourcePath, targetPath);
}

function escapeRegex(text) {
	return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function compileGlob(pattern) {
	const source = `^${escapeRegex(pattern).replaceAll("*", ".*")}$`;
	return new RegExp(source);
}

function getPublicHoistPatterns() {
	if (!pathExists(npmrcPath)) {
		return [];
	}

	const patterns = [];
	const contents = fs.readFileSync(npmrcPath, "utf8");
	for (const rawLine of contents.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) {
			continue;
		}

		const match = line.match(/^public-hoist-pattern\[\]=(.+)$/u);
		if (!match) {
			continue;
		}

		const pattern = match[1]?.trim();
		if (!pattern) {
			continue;
		}

		patterns.push({ pattern, regex: compileGlob(pattern) });
	}

	return patterns;
}

function getPnpmWorkspacePatterns() {
	if (!pathExists(pnpmWorkspaceYamlPath)) {
		return [];
	}

	const patterns = [];
	const contents = fs.readFileSync(pnpmWorkspaceYamlPath, "utf8");
	const lines = contents.split(/\r?\n/u);

	let inHoistSection = false;
	for (const rawLine of lines) {
		const line = rawLine.trimEnd();

		if (!inHoistSection) {
			if (/^publicHoistPattern\s*:/u.test(line)) {
				inHoistSection = true;
			}

			continue;
		}

		const match = line.match(/^\s+-\s+(.+)$/u);
		if (!match) {
			break;
		}

		const rawPattern = match[1]?.trim();
		if (!rawPattern) {
			continue;
		}

		const pattern = rawPattern.replace(/^['"](.*)['"]$/u, "$1");
		if (!pattern) {
			continue;
		}

		patterns.push({ pattern, regex: compileGlob(pattern) });
	}

	return patterns;
}

function getWorkspaceDirectories() {
	const output = execFileSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], {
		cwd: rootDirectory,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	const parsed = JSON.parse(output);
	if (!Array.isArray(parsed)) {
		return [];
	}

	const rootPath = normalizeForComparison(rootDirectory);
	const workspaces = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") {
			continue;
		}

		if (entry.private === true && normalizeForComparison(entry.path ?? "") === rootPath) {
			continue;
		}

		if (typeof entry.name !== "string" || entry.name.length === 0) {
			continue;
		}

		if (typeof entry.path !== "string" || entry.path.length === 0) {
			continue;
		}

		const packageName = entry.name;
		const workspacePath = entry.path;

		const packageJsonPath = path.join(workspacePath, "package.json");
		if (!pathExists(packageJsonPath)) {
			continue;
		}

		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
		workspaces.push({ packageJson, packageName, workspacePath });
	}

	return workspaces;
}

function normalizePackageRelativePath(value) {
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

	if (normalized.startsWith("../")) {
		return undefined;
	}

	return normalized;
}

function getHoistConfig(packageJson) {
	if (packageJson.hoist === false) {
		return { enabled: false, mode: "all" };
	}

	if (packageJson.hoist && typeof packageJson.hoist === "object") {
		const mode = packageJson.hoist.mode;
		if (mode === "dependencies" || mode === "devDependencies") {
			return { enabled: true, mode };
		}
	}

	return { enabled: true, mode: "all" };
}

function collectStringLeafPaths(value, output) {
	if (typeof value === "string") {
		const normalized = normalizePackageRelativePath(value);
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
			collectStringLeafPaths(item, output);
		}

		return;
	}

	for (const nestedValue of Object.values(value)) {
		collectStringLeafPaths(nestedValue, output);
	}
}

function getStageEntriesForPackage(packageJson) {
	const entries = new Set(["package.json"]);
	const directFields = [
		packageJson.main,
		packageJson.module,
		packageJson.types,
		packageJson.typings,
	];
	for (const field of directFields) {
		const normalized = normalizePackageRelativePath(field);
		if (normalized) {
			entries.add(normalized);
		}
	}

	if (Array.isArray(packageJson.files)) {
		for (const fileEntry of packageJson.files) {
			const normalized = normalizePackageRelativePath(fileEntry);
			if (normalized) {
				entries.add(normalized);
			}
		}
	}

	collectStringLeafPaths(packageJson.exports, entries);
	collectStringLeafPaths(packageJson.bin, entries);

	return [...entries].sort();
}

function pruneNestedStageEntries(workspacePath, relativePaths) {
	const prunedEntries = [];

	for (const relativePath of [...relativePaths].sort()) {
		const sourcePath = path.join(workspacePath, relativePath);
		if (!pathExists(sourcePath)) {
			continue;
		}

		const shouldSkip = prunedEntries.some((existingPath) => {
			if (!relativePath.startsWith(`${existingPath}/`)) {
				return false;
			}

			const existingSourcePath = path.join(workspacePath, existingPath);
			return pathExists(existingSourcePath) && fs.lstatSync(existingSourcePath).isDirectory();
		});
		if (shouldSkip) {
			continue;
		}

		prunedEntries.push(relativePath);
	}

	return prunedEntries;
}

function getDirectDependencyNames(packageJson, mode = "all") {
	const names = new Set();
	const sections = [];

	if (mode === "all" || mode === "dependencies") {
		sections.push(
			packageJson.dependencies,
			packageJson.peerDependencies,
			packageJson.optionalDependencies,
		);
	}

	if (mode === "all" || mode === "devDependencies") {
		sections.push(packageJson.devDependencies);
	}

	for (const dependencies of sections) {
		if (!dependencies || typeof dependencies !== "object") {
			continue;
		}

		for (const dependencyName of Object.keys(dependencies)) {
			names.add(dependencyName);
		}
	}

	return names;
}

function readDependencyTree(packageName) {
	const output = execFileSync(
		"pnpm",
		["--reporter", "silent", "--filter", packageName, "list", "--json", "--depth", "Infinity"],
		{ cwd: rootDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);

	const parsed = JSON.parse(output);
	return Array.isArray(parsed) ? parsed[0] : undefined;
}

function collectAllDependencyNames(node, output = new Set(), isRoot = true, mode = "all") {
	if (!node || typeof node !== "object") {
		return output;
	}

	const dependencySections = [];
	if (isRoot) {
		if (mode === "all" || mode === "dependencies") {
			dependencySections.push(
				{ deps: node.dependencies, key: "dependencies" },
				{ deps: node.optionalDependencies, key: "optionalDependencies" },
				{ deps: node.peerDependencies, key: "peerDependencies" },
			);
		}

		if (mode === "all" || mode === "devDependencies") {
			dependencySections.push({ deps: node.devDependencies, key: "devDependencies" });
		}
	} else {
		dependencySections.push(
			{ deps: node.dependencies, key: "dependencies" },
			{ deps: node.optionalDependencies, key: "optionalDependencies" },
			{ deps: node.peerDependencies, key: "peerDependencies" },
		);
	}

	for (const { deps: dependencies } of dependencySections) {
		if (!dependencies || typeof dependencies !== "object") {
			continue;
		}

		for (const [dependencyName, dependencyNode] of Object.entries(dependencies)) {
			output.add(dependencyName);
			collectAllDependencyNames(dependencyNode, output, false, mode);
		}
	}

	return output;
}

function ensureScopeDirectory(targetPackagePath) {
	const scopeDirectory = path.dirname(targetPackagePath);
	if (!pathExists(scopeDirectory)) {
		ensureDirectory(scopeDirectory);
		return;
	}

	const stats = fs.lstatSync(scopeDirectory);
	if (stats.isSymbolicLink() || resolvesOutsideSelf(scopeDirectory)) {
		removePath(scopeDirectory);
		ensureDirectory(scopeDirectory);
	}
}

function getWorkspaceStagePath(packageName) {
	return path.join(workspaceLinksRoot, packageName);
}

function stageWorkspacePackage({ packageJson, packageName, workspacePath }) {
	const targetPath = getWorkspaceStagePath(packageName);
	removePath(targetPath);
	ensureDirectory(targetPath);

	const stageEntries = pruneNestedStageEntries(
		workspacePath,
		getStageEntriesForPackage(packageJson),
	);
	for (const relativePath of stageEntries) {
		const sourcePath = path.join(workspacePath, relativePath);
		if (!pathExists(sourcePath)) {
			continue;
		}

		const targetEntryPath = path.join(targetPath, relativePath);
		const stats = fs.lstatSync(sourcePath);
		if (stats.isDirectory()) {
			ensureLink(sourcePath, targetEntryPath);
		} else {
			ensureCopiedFile(sourcePath, targetEntryPath);
		}
	}

	if (verbose) {
		console.log(
			`Staged ${packageName} at ${path.relative(rootDirectory, targetPath)} from ${path.relative(rootDirectory, workspacePath)}`,
		);
	}
}

function buildWorkspaceStages(workspaces) {
	ensureDirectory(workspaceLinksRoot);
	for (const workspace of workspaces) {
		stageWorkspacePackage(workspace);
	}
}

function getLocalPackageWorkspaces() {
	const workspaces = [];
	const roots = [path.join(rootDirectory, "packages"), path.join(rootDirectory, "tools")];

	function visit(directory) {
		if (!pathExists(directory)) {
			return;
		}

		const directoryEntries = fs.readdirSync(directory, { withFileTypes: true });
		for (const entry of directoryEntries) {
			if (entry.name === "node_modules" || entry.name === "submodules") {
				continue;
			}

			const entryPath = path.join(directory, entry.name);
			if (!entry.isDirectory() && !entry.isSymbolicLink()) {
				continue;
			}

			const packageJsonPath = path.join(entryPath, "package.json");
			if (pathExists(packageJsonPath)) {
				const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
				if (typeof packageJson.name === "string" && packageJson.name.length > 0) {
					workspaces.push({
						packageJson,
						packageName: packageJson.name,
						workspacePath: entryPath,
					});
				}

				continue;
			}

			visit(entryPath);
		}
	}

	for (const root of roots) {
		visit(root);
	}

	return workspaces;
}

function syncWorkspaceIntoRoot(workspace) {
	const sourcePath = workspace.workspacePath;
	const targetPath = path.join(rootNodeModules, workspace.packageName);
	ensureScopeDirectory(targetPath);
	ensureLink(sourcePath, targetPath);
	return true;
}

function syncWorkspacesIntoRoot(workspaces, patterns) {
	let linked = 0;
	for (const workspace of workspaces) {
		if (patterns.every(({ regex }) => !regex.test(workspace.packageName))) {
			continue;
		}

		if (syncWorkspaceIntoRoot(workspace)) {
			linked++;
		}
	}

	return linked;
}

function cleanupRootWorkspaceLinks(workspaces, patterns) {
	if (!pathExists(rootNodeModules)) {
		return;
	}

	const activeNames = new Set(
		workspaces
			.filter((workspace) => patterns.some(({ regex }) => regex.test(workspace.packageName)))
			.map((workspace) => workspace.packageName),
	);

	for (const entry of fs.readdirSync(rootNodeModules)) {
		const scopePath = path.join(rootNodeModules, entry);
		const candidates =
			entry.startsWith("@") && pathExists(scopePath)
				? fs.readdirSync(scopePath).map((name) => path.join(scopePath, name))
				: [scopePath];
		for (const candidate of candidates) {
			const packageName = path.relative(rootNodeModules, candidate).replaceAll(path.sep, "/");
			if (!activeNames.has(packageName) && pathExists(candidate)) {
				const resolvedPath = tryRealpath(candidate);
				if (resolvedPath?.startsWith(`${workspaceLinksRoot}${path.sep}`)) {
					removePath(candidate);
				}
			}
		}
	}
}

function resolvePackageSource(dependencyName, workspaceMap) {
	const workspace = workspaceMap.get(dependencyName);
	if (workspace) {
		const stagedPath = getWorkspaceStagePath(dependencyName);
		return pathExists(stagedPath) ? stagedPath : undefined;
	}

	const sourcePath = path.join(rootDirectory, "node_modules", dependencyName);
	return pathExists(sourcePath) ? sourcePath : undefined;
}

function syncPackageIntoWorkspace(workspacePath, dependencyName, workspaceMap) {
	const sourcePath = resolvePackageSource(dependencyName, workspaceMap);
	if (!sourcePath) {
		return false;
	}

	const targetPath = path.join(workspacePath, "node_modules", dependencyName);
	ensureScopeDirectory(targetPath);
	ensureLink(sourcePath, targetPath);

	if (verbose) {
		console.log(
			`Linked ${path.relative(rootDirectory, targetPath)} -> ${path.relative(rootDirectory, sourcePath)}`,
		);
	}

	return true;
}

function parseCliArgs(argv) {
	const options = { relink: [], stage: [] };
	let mode;

	for (const argument of argv) {
		if (argument === "--stage") {
			mode = "stage";
			continue;
		}

		if (argument === "--relink") {
			mode = "relink";
			continue;
		}

		if (argument.startsWith("-")) {
			continue;
		}

		if (mode === undefined) {
			options.stage.push(argument);
			options.relink.push(argument);
			continue;
		}

		options[mode].push(argument);
	}

	return {
		relink: [...new Set(options.relink)],
		stage: [...new Set(options.stage)],
	};
}

function filterWorkspacesByName(workspaces, packageNames) {
	if (packageNames.length === 0) {
		return workspaces;
	}

	const selectedNames = new Set(packageNames);
	return workspaces.filter((workspace) => selectedNames.has(workspace.packageName));
}

function main() {
	const npmrcPatterns = getPublicHoistPatterns();
	const workspacePatterns = getPnpmWorkspacePatterns();

	const patternMap = new Map();
	for (const pattern of npmrcPatterns) {
		patternMap.set(pattern.pattern, pattern);
	}

	for (const pattern of workspacePatterns) {
		patternMap.set(pattern.pattern, pattern);
	}

	const patterns = [...patternMap.values()];
	if (patterns.length === 0) {
		console.warn("No public hoist patterns found; syncing workspace dependency trees.");
	}

	const { relink: relinkNames, stage: stageNames } = parseCliArgs(process.argv.slice(2));
	const allWorkspaces = getWorkspaceDirectories();
	if (allWorkspaces.length === 0) {
		console.warn("No workspace packages found to sync.");
		return;
	}

	const workspacesToStage = filterWorkspacesByName(allWorkspaces, stageNames);
	const workspacesToRelink = filterWorkspacesByName(allWorkspaces, relinkNames);
	if (workspacesToStage.length === 0 && workspacesToRelink.length === 0) {
		console.warn("No matching workspace packages found to sync.");
		return;
	}

	const workspaceMap = new Map(
		allWorkspaces.map((workspace) => [workspace.packageName, workspace]),
	);
	const localWorkspaces = getLocalPackageWorkspaces();
	cleanupRootWorkspaceLinks(localWorkspaces, patterns);
	const rootWorkspaceLinks = syncWorkspacesIntoRoot(localWorkspaces, patterns);
	if (workspacesToStage.length > 0) {
		buildWorkspaceStages(workspacesToStage);
	}

	let totalLinked = 0;
	for (const { packageJson, packageName, workspacePath } of workspacesToRelink) {
		const hoistConfig = getHoistConfig(packageJson);
		if (!hoistConfig.enabled) {
			if (verbose) {
				console.log(`Skipped hoist for ${packageName} (disabled in package.json)`);
			}

			continue;
		}

		const mode = hoistConfig.mode;
		ensureDirectory(path.join(workspacePath, "node_modules"));
		const dependencyTree = readDependencyTree(packageName);
		const directDependencyNames = getDirectDependencyNames(packageJson, mode);
		const matchingPackages = [
			...collectAllDependencyNames(dependencyTree, new Set(), true, mode),
		]
			.filter(
				(dependencyName) =>
					patterns.length === 0 ||
					patterns.some(({ regex }) => regex.test(dependencyName)),
			)
			.filter(
				(dependencyName) =>
					!workspaceMap.has(dependencyName) || directDependencyNames.has(dependencyName),
			)
			.sort();
		const linkedForWorkspace = matchingPackages.filter((dependencyName) =>
			syncPackageIntoWorkspace(workspacePath, dependencyName, workspaceMap),
		).length;
		totalLinked += linkedForWorkspace;

		console.log(
			`Synced ${linkedForWorkspace} hoisted packages into ${path.relative(rootDirectory, workspacePath)}`,
		);
	}

	console.log(
		`Hoist sync complete: staged ${workspacesToStage.length} workspace(s), relinked ${workspacesToRelink.length} workspace(s), linked ${rootWorkspaceLinks} root workspace package(s), updated ${totalLinked} package link(s).`,
	);
}

main();

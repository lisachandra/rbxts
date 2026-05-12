#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const npmrcPath = path.join(rootDir, ".npmrc");
const pnpmWorkspaceYamlPath = path.join(rootDir, "pnpm-workspace.yaml");
const workspaceLinksRoot = path.join(rootDir, ".workspace-links");
const verbose = process.env["HOIST_VERBOSE"] === "1";

function pathExists(targetPath) {
	try {
		fs.lstatSync(targetPath);
		return true;
	} catch {
		return false;
	}
}

function normalizeForComparison(targetPath) {
	return path.normalize(targetPath).replace(/[\\/]+$/u, "").toLowerCase();
}

function resolvesOutsideSelf(targetPath) {
	if (!pathExists(targetPath)) return false;

	try {
		const resolvedPath = fs.realpathSync.native(targetPath);
		return normalizeForComparison(resolvedPath) !== normalizeForComparison(path.resolve(targetPath));
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
	if (!pathExists(targetPath)) return;
	fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureLink(sourcePath, targetPath) {
	ensureDirectory(path.dirname(targetPath));

	if (pathExists(targetPath)) {
		const existingResolvedPath = tryRealpath(targetPath);
		const sourceResolvedPath = tryRealpath(sourcePath) ?? path.resolve(sourcePath);
		if (
			existingResolvedPath !== undefined &&
			normalizeForComparison(existingResolvedPath) === normalizeForComparison(sourceResolvedPath)
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
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
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

		throw error;
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
	if (!pathExists(npmrcPath)) return [];

	const patterns = [];
	const contents = fs.readFileSync(npmrcPath, "utf8");
	for (const rawLine of contents.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;

		const match = line.match(/^public-hoist-pattern\[\]=(.+)$/u);
		if (!match) continue;

		const pattern = match[1]?.trim();
		if (!pattern) continue;
		patterns.push({ pattern, regex: compileGlob(pattern) });
	}

	return patterns;
}

function getPnpmWorkspacePatterns() {
	if (!pathExists(pnpmWorkspaceYamlPath)) return [];

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
		if (!match) break;

		const rawPattern = match[1]?.trim();
		if (!rawPattern) continue;

		const pattern = rawPattern.replace(/^['"](.*)['"]$/u, "$1");
		if (!pattern) continue;

		patterns.push({ pattern, regex: compileGlob(pattern) });
	}

	return patterns;
}

function getWorkspaceDirectories() {
	const output = execFileSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], {
		cwd: rootDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	const parsed = JSON.parse(output);
	if (!Array.isArray(parsed)) {
		return [];
	}

	const rootPath = normalizeForComparison(rootDir);
	const workspaces = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") continue;
		if (entry.private === true && normalizeForComparison(entry.path ?? "") === rootPath) continue;

		const packageName = entry.name;
		const workspacePath = entry.path;
		if (typeof packageName !== "string" || packageName.length === 0) continue;
		if (typeof workspacePath !== "string" || workspacePath.length === 0) continue;

		const packageJsonPath = path.join(workspacePath, "package.json");
		if (!pathExists(packageJsonPath)) continue;
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
		workspaces.push({ packageName, workspacePath, packageJson });
	}

	return workspaces;
}

function normalizePackageRelativePath(value) {
	if (typeof value !== "string") return undefined;
	if (value.length === 0) return undefined;
	if (value.includes("*")) return undefined;
	if (path.isAbsolute(value)) return undefined;

	const normalized = value.startsWith("./") ? value.slice(2) : value;
	if (normalized.length === 0) return undefined;
	if (normalized.startsWith("../")) return undefined;

	return normalized;
}

function collectStringLeafPaths(value, output) {
	if (typeof value === "string") {
		const normalized = normalizePackageRelativePath(value);
		if (normalized) output.add(normalized);
		return;
	}

	if (!value || typeof value !== "object") return;

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
	const directFields = [packageJson.main, packageJson.module, packageJson.types, packageJson.typings];
	for (const field of directFields) {
		const normalized = normalizePackageRelativePath(field);
		if (normalized) entries.add(normalized);
	}

	if (Array.isArray(packageJson.files)) {
		for (const fileEntry of packageJson.files) {
			const normalized = normalizePackageRelativePath(fileEntry);
			if (normalized) entries.add(normalized);
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
		if (!pathExists(sourcePath)) continue;

		const shouldSkip = prunedEntries.some((existingPath) => {
			if (!relativePath.startsWith(`${existingPath}/`)) return false;

			const existingSourcePath = path.join(workspacePath, existingPath);
			return pathExists(existingSourcePath) && fs.lstatSync(existingSourcePath).isDirectory();
		});
		if (shouldSkip) continue;

		prunedEntries.push(relativePath);
	}

	return prunedEntries;
}

function getDirectDependencyNames(packageJson) {
	const names = new Set();
	const sections = [
		packageJson.dependencies,
		packageJson.devDependencies,
		packageJson.peerDependencies,
		packageJson.optionalDependencies,
	];

	for (const dependencies of sections) {
		if (!dependencies || typeof dependencies !== "object") continue;
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
		{ cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);

	const parsed = JSON.parse(output);
	return Array.isArray(parsed) ? parsed[0] : undefined;
}

function collectMatchingPackages(node, patterns, output = new Set(), isRoot = true) {
	if (!node || typeof node !== "object") return output;

	const dependencySections = isRoot
		? [node.dependencies, node.devDependencies, node.optionalDependencies]
		: [node.dependencies, node.optionalDependencies];

	for (const dependencies of dependencySections) {
		if (!dependencies || typeof dependencies !== "object") continue;

		for (const [dependencyName, dependencyNode] of Object.entries(dependencies)) {
			if (patterns.some(({ regex }) => regex.test(dependencyName))) {
				output.add(dependencyName);
			}
			collectMatchingPackages(dependencyNode, patterns, output, false);
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

function stageWorkspacePackage({ packageName, workspacePath, packageJson }) {
	const targetPath = getWorkspaceStagePath(packageName);
	removePath(targetPath);
	ensureDirectory(targetPath);

	for (const relativePath of pruneNestedStageEntries(workspacePath, getStageEntriesForPackage(packageJson))) {
		const sourcePath = path.join(workspacePath, relativePath);
		if (!pathExists(sourcePath)) continue;

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
			`Staged ${packageName} at ${path.relative(rootDir, targetPath)} from ${path.relative(rootDir, workspacePath)}`,
		);
	}
}

function buildWorkspaceStages(workspaces) {
	ensureDirectory(workspaceLinksRoot);
	for (const workspace of workspaces) {
		stageWorkspacePackage(workspace);
	}
}

function resolvePackageSource(dependencyName, workspaceMap) {
	const workspace = workspaceMap.get(dependencyName);
	if (workspace) {
		const stagedPath = getWorkspaceStagePath(dependencyName);
		return pathExists(stagedPath) ? stagedPath : undefined;
	}

	const sourcePath = path.join(rootDir, "node_modules", dependencyName);
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
		console.log(`Linked ${path.relative(rootDir, targetPath)} -> ${path.relative(rootDir, sourcePath)}`);
	}

	return true;
}

function parseCliArgs(argv) {
	const options = { stage: [], relink: [] };
	let mode = undefined;

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
		stage: [...new Set(options.stage)],
		relink: [...new Set(options.relink)],
	};
}

function filterWorkspacesByName(workspaces, packageNames) {
	if (packageNames.length === 0) return workspaces;
	const selectedNames = new Set(packageNames);
	return workspaces.filter((workspace) => selectedNames.has(workspace.packageName));
}

function main() {
	const npmrcPatterns = getPublicHoistPatterns();
	const workspacePatterns = getPnpmWorkspacePatterns();

	const patternMap = new Map();
	for (const pattern of npmrcPatterns) patternMap.set(pattern.pattern, pattern);
	for (const pattern of workspacePatterns) patternMap.set(pattern.pattern, pattern);
	const patterns = [...patternMap.values()];
	if (patterns.length === 0) {
		console.warn("No public hoist patterns found in .npmrc or pnpm-workspace.yaml.");
		return;
	}

	const { stage: stageNames, relink: relinkNames } = parseCliArgs(process.argv.slice(2));
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

	const workspaceMap = new Map(allWorkspaces.map((workspace) => [workspace.packageName, workspace]));
	if (workspacesToStage.length > 0) {
		buildWorkspaceStages(workspacesToStage);
	}

	let totalLinked = 0;
	for (const { packageName, workspacePath, packageJson } of workspacesToRelink) {
		ensureDirectory(path.join(workspacePath, "node_modules"));
		const dependencyTree = readDependencyTree(packageName);
		const directDependencyNames = getDirectDependencyNames(packageJson);
		const matchingPackages = [...collectMatchingPackages(dependencyTree, patterns)]
			.filter((dependencyName) => !workspaceMap.has(dependencyName) || directDependencyNames.has(dependencyName))
			.sort();
		let linkedForWorkspace = 0;
		for (const dependencyName of matchingPackages) {
			if (syncPackageIntoWorkspace(workspacePath, dependencyName, workspaceMap)) {
				linkedForWorkspace++;
				totalLinked++;
			}
		}

		console.log(`Synced ${linkedForWorkspace} hoisted packages into ${path.relative(rootDir, workspacePath)}`);
	}

	console.log(
		`Hoist sync complete: staged ${workspacesToStage.length} workspace(s), relinked ${workspacesToRelink.length} workspace(s), updated ${totalLinked} package link(s).`,
	);
}

main();

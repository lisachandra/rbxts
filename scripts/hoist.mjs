#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const workspaceRoots = ["packages", "test"];
const npmrcPath = path.join(rootDir, ".npmrc");
const verbose = process.env["HOIST_VERBOSE"] === "1";

function pathExists(targetPath) {
	return fs.existsSync(targetPath);
}

function ensureDirectory(targetPath) {
	fs.mkdirSync(targetPath, { recursive: true });
}

function removePath(targetPath) {
	if (!pathExists(targetPath)) return;
	fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureLink(sourcePath, targetPath) {
	removePath(targetPath);
	ensureDirectory(path.dirname(targetPath));
	const linkType = process.platform === "win32" ? "junction" : "dir";
	fs.symlinkSync(sourcePath, targetPath, linkType);
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

function getWorkspaceDirectories() {
	const workspaces = [];

	for (const workspaceRoot of workspaceRoots) {
		const basePath = path.join(rootDir, workspaceRoot);
		if (!pathExists(basePath)) continue;

		for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const workspacePath = path.join(basePath, entry.name);
			const packageJsonPath = path.join(workspacePath, "package.json");
			if (!pathExists(packageJsonPath)) continue;
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
			const packageName = packageJson.name;
			if (typeof packageName !== "string" || packageName.length === 0) continue;
			workspaces.push({ packageName, workspacePath });
		}
	}

	return workspaces;
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

function collectMatchingPackages(node, patterns, output = new Set()) {
	if (!node || typeof node !== "object") return output;

	const dependencies = node.dependencies;
	if (!dependencies || typeof dependencies !== "object") return output;

	for (const [dependencyName, dependencyNode] of Object.entries(dependencies)) {
		if (patterns.some(({ regex }) => regex.test(dependencyName))) {
			output.add(dependencyName);
		}
		collectMatchingPackages(dependencyNode, patterns, output);
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
	if (stats.isSymbolicLink()) {
		removePath(scopeDirectory);
		ensureDirectory(scopeDirectory);
	}
}

function syncPackageIntoWorkspace(workspacePath, dependencyName) {
	const sourcePath = path.join(rootDir, "node_modules", dependencyName);
	if (!pathExists(sourcePath)) {
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

function main() {
	const patterns = getPublicHoistPatterns();
	if (patterns.length === 0) {
		console.warn("No public-hoist-pattern entries found in .npmrc.");
		return;
	}

	const workspaces = getWorkspaceDirectories();
	if (workspaces.length === 0) {
		console.warn("No workspace packages found to sync.");
		return;
	}

	let totalLinked = 0;
	for (const { packageName, workspacePath } of workspaces) {
		ensureDirectory(path.join(workspacePath, "node_modules"));
		const dependencyTree = readDependencyTree(packageName);
		const matchingPackages = [...collectMatchingPackages(dependencyTree, patterns)].sort();

		let linkedForWorkspace = 0;
		for (const dependencyName of matchingPackages) {
			if (syncPackageIntoWorkspace(workspacePath, dependencyName)) {
				linkedForWorkspace++;
				totalLinked++;
			}
		}

		console.log(`Synced ${linkedForWorkspace} hoisted packages into ${path.relative(rootDir, workspacePath)}`);
	}

	console.log(`Hoist sync complete: ${totalLinked} package links updated across ${workspaces.length} workspaces.`);
}

main();

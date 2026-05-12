#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv) {
	const options = {
		scope: "all",
		target: undefined,
		dryRun: false,
		verbose: process.env["BUILD_VERBOSE"] === "1",
	};

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--scope") {
			options.scope = argv[++index] ?? options.scope;
			continue;
		}

		if (argument === "--target") {
			options.target = argv[++index];
			continue;
		}

		if (argument === "--dry-run") {
			options.dryRun = true;
			continue;
		}

		if (argument === "--verbose") {
			options.verbose = true;
			continue;
		}
	}

	if (!["all", "packages", "test"].includes(options.scope)) {
		throw new Error(`Unsupported scope: ${options.scope}`);
	}

	return options;
}

function runCommand(command, args, options = {}) {
	if (options.verbose || options.dryRun) {
		console.log(`> ${command} ${args.join(" ")}`);
	}

	if (options.dryRun) return;

	execFileSync(command, args, {
		cwd: rootDir,
		stdio: "inherit",
		env: process.env,
	});
}

function runCommandForOutput(command, args) {
	return execFileSync(command, args, {
		cwd: rootDir,
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf8",
		env: process.env,
	});
}

function normalizePath(targetPath) {
	return path.relative(rootDir, targetPath).replace(/\\/gu, "/");
}

function collectDependencyNames(packageJson) {
	const sections = [
		packageJson.dependencies,
		packageJson.devDependencies,
		packageJson.peerDependencies,
		packageJson.optionalDependencies,
	];
	const dependencyNames = new Set();

	for (const section of sections) {
		if (!section || typeof section !== "object") continue;
		for (const dependencyName of Object.keys(section)) {
			dependencyNames.add(dependencyName);
		}
	}

	return dependencyNames;
}

function getWorkspaces() {
	const output = runCommandForOutput("pnpm", ["list", "-r", "--depth", "-1", "--json"]);
	const parsed = JSON.parse(output);
	if (!Array.isArray(parsed)) return [];

	return parsed
		.filter((entry) => entry && typeof entry === "object" && typeof entry.name === "string" && typeof entry.path === "string")
		.map((entry) => {
			const packageJsonPath = path.join(entry.path, "package.json");
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
			return {
				name: entry.name,
				path: entry.path,
				relativePath: normalizePath(entry.path),
				packageJson,
			};
		});
}

function filterWorkspacesByScope(workspaces, scope) {
	if (scope === "all") {
		return workspaces.filter((workspace) =>
			workspace.relativePath.startsWith("packages/") || workspace.relativePath.startsWith("test/"),
		);
	}

	return workspaces.filter((workspace) => workspace.relativePath.startsWith(`${scope}/`));
}

function selectRootTargets(workspaces, scope, target) {
	const workspaceMap = new Map(workspaces.map((workspace) => [workspace.name, workspace]));

	if (target) {
		const workspace = workspaceMap.get(target);
		if (!workspace) {
			throw new Error(`Unknown workspace target: ${target}`);
		}

		return [workspace.name];
	}

	return filterWorkspacesByScope(workspaces, scope).map((workspace) => workspace.name);
}

function expandDependencyClosure(rootTargets, workspaceMap) {
	const selected = new Set();
	const queue = [...rootTargets];

	while (queue.length > 0) {
		const packageName = queue.shift();
		if (!packageName || selected.has(packageName)) continue;

		const workspace = workspaceMap.get(packageName);
		if (!workspace) continue;

		selected.add(packageName);
		for (const dependencyName of collectDependencyNames(workspace.packageJson)) {
			if (workspaceMap.has(dependencyName) && !selected.has(dependencyName)) {
				queue.push(dependencyName);
			}
		}
	}

	return selected;
}

function buildDependentsMap(selectedNames, workspaceMap) {
	const dependentsMap = new Map();
	for (const packageName of selectedNames) {
		dependentsMap.set(packageName, new Set());
	}

	for (const packageName of selectedNames) {
		const workspace = workspaceMap.get(packageName);
		if (!workspace) continue;

		for (const dependencyName of collectDependencyNames(workspace.packageJson)) {
			if (!selectedNames.has(dependencyName)) continue;
			dependentsMap.get(dependencyName)?.add(packageName);
		}
	}

	return dependentsMap;
}

function buildLayers(selectedNames, workspaceMap) {
	const indegree = new Map();
	const dependents = buildDependentsMap(selectedNames, workspaceMap);

	for (const packageName of selectedNames) {
		indegree.set(packageName, 0);
	}

	for (const packageName of selectedNames) {
		const workspace = workspaceMap.get(packageName);
		if (!workspace) continue;

		for (const dependencyName of collectDependencyNames(workspace.packageJson)) {
			if (!selectedNames.has(dependencyName)) continue;
			indegree.set(packageName, (indegree.get(packageName) ?? 0) + 1);
		}
	}

	const ready = [...selectedNames].filter((packageName) => (indegree.get(packageName) ?? 0) === 0).sort();
	const layers = [];
	let processedCount = 0;

	while (ready.length > 0) {
		const currentLayer = [...ready].sort();
		ready.length = 0;
		layers.push(currentLayer);

		for (const packageName of currentLayer) {
			processedCount++;
			for (const dependentName of dependents.get(packageName) ?? []) {
				const nextDegree = (indegree.get(dependentName) ?? 0) - 1;
				indegree.set(dependentName, nextDegree);
				if (nextDegree === 0) {
					ready.push(dependentName);
				}
			}
		}
	}

	if (processedCount !== selectedNames.size) {
		throw new Error("Workspace dependency cycle detected while building selected packages.");
	}

	return { layers, dependents };
}

function formatPackageList(packageNames) {
	return packageNames.length > 0 ? packageNames.join(", ") : "(none)";
}

function collectRelinkTargets(changedPackages, dependentsMap, selectedNames) {
	const targets = new Set();
	for (const packageName of changedPackages) {
		for (const dependentName of dependentsMap.get(packageName) ?? []) {
			if (selectedNames.has(dependentName)) {
				targets.add(dependentName);
			}
		}
	}

	return [...targets].sort();
}

function runHoist({ stage = [], relink = [] }, options) {
	if (stage.length === 0 && relink.length === 0) {
		return;
	}

	const args = ["./scripts/hoist.mjs"];
	if (stage.length > 0) {
		args.push("--stage", ...stage);
	}
	if (relink.length > 0) {
		args.push("--relink", ...relink);
	}

	console.log(`Refreshing workspace links: stage=${formatPackageList(stage)} relink=${formatPackageList(relink)}`);
	runCommand("node", args, options);
}

function runBuildForPackage(packageName, options) {
	console.log(`Building ${packageName}...`);
	runCommand("pnpm", ["--filter", packageName, "run", "build"], options);
}

function printBuildPlan(rootTargets, selectedNames, layers, dependentsMap) {
	console.log(`Root targets: ${formatPackageList(rootTargets)}`);
	console.log(`Selected packages (${selectedNames.size}): ${formatPackageList([...selectedNames].sort())}`);
	if (layers.length > 0) {
		console.log(`Pre-build hoist: stage=(none) relink=${formatPackageList(layers[0])}`);
	}
	for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
		const layer = layers[layerIndex];
		console.log(`Layer ${layerIndex + 1}/${layers.length}: ${formatPackageList(layer)}`);
		const relinkTargets = collectRelinkTargets(layer, dependentsMap, selectedNames);
		if (layerIndex < layers.length - 1) {
			console.log(`  post-build hoist: stage=${formatPackageList(layer)} relink=${formatPackageList(relinkTargets)}`);
		}
	}
	if (layers.length > 0) {
		console.log("No final hoist after the last layer.");
	}
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const workspaces = getWorkspaces();
	const workspaceMap = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
	const rootTargets = selectRootTargets(workspaces, options.scope, options.target);

	if (rootTargets.length === 0) {
		console.warn(`No workspaces matched scope '${options.scope}'.`);
		return;
	}

	const selectedNames = expandDependencyClosure(rootTargets, workspaceMap);
	const { layers, dependents } = buildLayers(selectedNames, workspaceMap);

	console.log(`Selected ${selectedNames.size} workspace package(s) across ${layers.length} build layer(s).`);
	if (options.dryRun) {
		printBuildPlan(rootTargets, selectedNames, layers, dependents);
	}

	if (layers.length === 0) return;

	runHoist({ relink: layers[0] }, options);

	for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
		const layer = layers[layerIndex];
		console.log(`Build layer ${layerIndex + 1}/${layers.length}: ${layer.join(", ")}`);
		for (const packageName of layer) {
			runBuildForPackage(packageName, options);
		}

		const nextLayer = layers[layerIndex + 1];
		if (nextLayer) {
			runHoist({
				stage: layer,
				relink: collectRelinkTargets(layer, dependents, selectedNames),
			}, options);
		}
	}

	console.log(`Build complete for ${selectedNames.size} workspace package(s).`);
}

main();

#!/usr/bin/env node
/*
 * Scaffold every test workspace's container folders for the emulator lane.
 *
 * The emulator backend stages only `$path` mounts, so a container a Rojo
 * project declares as a bare `$className` folder (`ReplicatedStorage.Models`,
 * `Workspace.Caches.Sound`) never reaches the stage — and a module that indexes
 * it at require time dies with `<Name> is not a valid member of ...`.
 * `scaffoldContainers.luau` serialises those folders to `<Service>.rbxm`
 * bundles that ree loads through `--snapshot-directory` before the mounts, so the
 * containers exist offline with no Studio place required.
 *
 * Each test project gets its own `build/ui-templates` because the jest run is
 * per-project and `emulator.snapshotsDirectory` resolves against that project's
 * rootDir. Running one project therefore never needs another's bundles.
 *
 * Usage: node scripts/emulator/scaffold.mjs [projectDir...]
 *   Default targets: every `test/<name>/default.project.json`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = "build/ui-templates";

function defaultTargets() {
	const testRoot = "test";
	if (!fs.existsSync(testRoot)) {return [];}

	return fs
		.readdirSync(testRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(testRoot, entry.name))
		.filter((directory) => fs.existsSync(path.join(directory, "default.project.json")))
		.sort();
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : defaultTargets();
if (targets.length === 0) {
	console.log("no test projects found; nothing to scaffold");
	process.exit(0);
}

let failures = 0;
for (const directory of targets) {
	const project = path.join(directory, "default.project.json");
	const outDirectory = path.join(directory, OUTPUT_DIR);
	console.log(`scaffold ${project} -> ${outDirectory}`);
	const result = spawnSync(
		"lune",
		["run", "scripts/luau/scaffoldContainers.luau", project, outDirectory],
		{ encoding: "utf8", shell: process.platform === "win32" },
	);
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
	if (output !== "") {console.log(output);}

	if (result.status !== 0) {
		failures++;
		console.error(`  failed with exit code ${result.status}`);
	}
}

if (failures > 0) {
	console.error(`\n${failures} of ${targets.length} scaffold run(s) failed`);
	process.exit(1);
}

console.log(`\nscaffolded ${targets.length} test project(s)`);

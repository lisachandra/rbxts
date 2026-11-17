/*
 * The emulator lane stages only `$path` mounts, so a container a Rojo project declares as a bare
 * `$className` folder never reaches the stage, and a module that indexes it at require time dies with
 * "is not a valid member". `scripts/emulator/scaffold.mjs` serialises those folders to bundles under
 * each project's `build/ui-templates`, and `jest.shared.ts` points `emulator.snapshotsDirectory` at
 * them.
 *
 * That made a gitignored, generated artifact load-bearing: `build/` is ignored, so a fresh checkout
 * — and therefore CI, which had never run the scaffold — had no bundles, and the failure surfaced as
 * tests that could not require a module rather than as a missing build step. These specs assert the
 * two properties that keep the lane runnable: the project declares no container it does not mount,
 * and every declared container has a bundle when the scaffolds are present.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { containsMount, isContainer, scaffoldedContainers } from "./scaffoldPaths.mjs";

const OUTPUT_DIR = path.join("build", "ui-templates");

/** Every `test/<name>/default.project.json`, or none when the tree has no test workspaces. */
function testProjects() {
	const testRoot = "test";
	if (!fs.existsSync(testRoot)) {
		return [];
	}

	return fs
		.readdirSync(testRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(testRoot, entry.name))
		.filter((directory) => fs.existsSync(path.join(directory, "default.project.json")))
		.sort();
}

/** The bundle files a scaffold run writes, relative to the project directory. */
function bundleNames(directory) {
	const outDirectory = path.join(directory, OUTPUT_DIR);
	if (!fs.existsSync(outDirectory)) {
		return [];
	}

	return fs
		.readdirSync(outDirectory)
		.filter((name) => name.endsWith(".rbxm"))		.map((name) => path.basename(name, path.extname(name)));
}

describe("the emulator scaffold covers every container a test project declares", () => {
	/*
	 * This is the assertion that would have caught the CI failure. `$path` mounts are staged by Rojo
	 * itself; everything else in the tree is the scaffold's job, and a container with no bundle is a
	 * test run that cannot start.
	 */
	for (const directory of testProjects()) {
		test(`${directory} declares only containers it mounts or scaffolds`, () => {
			const project = JSON.parse(
				fs.readFileSync(path.join(directory, "default.project.json"), "utf-8"),
			);
			const declared = scaffoldedContainers(project);
			if (declared.length === 0) {
				return;
			}

			const bundles = bundleNames(directory);
			assert.notDeepEqual(
				bundles,
				[],
				`${directory}: declares ${String(declared.length)} container(s) but has no ${OUTPUT_DIR} — run \`pnpm ui:templates\``,
			);

			/*
			 * The scaffold serialises per top-level service, so a bundle is named for the service and
			 * carries the nested containers inside it. A declared container is therefore covered when
			 * its root segment has a bundle.
			 */
			const uncovered = declared
				.map((container) => container.path.split(".")[0])
				.filter((root) => !bundles.includes(root));

			assert.deepEqual(
				[...new Set(uncovered)],
				[],
				`${directory}: no bundle for ${[...new Set(uncovered)].join(", ")} — run \`pnpm ui:templates\``,
			);
		});
	}
});

describe("the scaffold is reachable from the command a fresh checkout runs", () => {
	/*
	 * The coverage spec above is only meaningful if something generates the bundles, and the two ways
	 * that guarantee breaks are silent: `lune` is not pinned, so a runner falls back to whatever it
	 * has; or the scaffold is dropped from `setup`, so CI and a fresh clone skip it. Both were true
	 * when the test job was first read, hence the explicit assertions.
	 */
	test("lune is pinned in mise.toml", () => {
		const mise = fs.readFileSync("mise.toml", "utf-8");

		assert.match(
			mise,
			/^\[tools\]$/m,
			"mise.toml must declare a [tools] table for the pin to be resolved by mise",
		);
		assert.match(
			mise,
			/"github:lune-org\/lune"\s*=\s*"\d+\.\d+\.\d+"/,
			'lune must be pinned as `"github:lune-org/lune" = "x.y.z"`; a runner has only this repo\'s mise.toml',
		);
	});

	test("pnpm setup generates the scaffolds", () => {
		const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf-8"));
		const setup = rootPackage.scripts?.setup;

		assert.equal(typeof setup, "string", "package.json must define a setup script");
		assert.match(
			` ${setup} `,
			/\s(?:pnpm )?ui:templates\s/,
			"`setup` must run the scaffold; otherwise a fresh checkout — and therefore CI — has no bundles",
		);
	});
});

describe("the scaffold's container rule", () => {
	test("a literal Folder with no $path is a container", () => {
		assert.equal(isContainer({ $className: "Folder" }), true);
	});

	test("a mount is not a container, whatever its class", () => {
		assert.equal(isContainer({ $className: "Folder", $path: "out" }), false);
	});

	test("only Folder declarations are scaffolded", () => {
		// A `RemoteEvent` or `Script` is created by its declaring project, not by the scaffold.
		assert.equal(isContainer({ $className: "RemoteEvent" }), false);
		assert.equal(isContainer({ $className: "ModuleScript" }), false);
		assert.equal(isContainer(undefined), false);
		assert.equal(isContainer("Folder"), false);
	});

	test("a folder whose subtree carries a mount is a mount parent, not a container", () => {
		/*
		 * `ReplicatedStorage.TS` holds `rbxts_include` and the compiled tests. The stage builds it to
		 * hold those mounts, so scaffolding an empty twin would shadow the real one.
		 */
		const mountParent = {
			$className: "Folder",
			ts: { $path: "out" },
		};

		assert.equal(isContainer(mountParent), true, "it is shaped like a folder");
		assert.equal(containsMount(mountParent), true, "but its subtree is mounted");
	});

	test("a folder of plain subfolders has no mount", () => {
		assert.equal(
			containsMount({
				$className: "Folder",
				child: { $className: "Folder" },
			}),
			false,
		);
	});

	test("scaffoldedContainers lists nested folders parents first", () => {
		const project = {
			tree: {
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					Models: { $className: "Folder", Items: { $className: "Folder" } },
					Mounted: { $className: "Folder", out: { $path: "out" } },
				},
			},
		};

		assert.deepEqual(
			scaffoldedContainers(project).map((container) => container.path),
			["ReplicatedStorage.Models", "ReplicatedStorage.Models.Items"],
			"a mount parent is skipped and its siblings are not",
		);
	});
});

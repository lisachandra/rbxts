/*
 * Specs for the path predicates `scripts/hoist.mjs` deletes and links with.
 *
 * Plain `node:test`, because `scripts/` has no other harness and these are pure functions: the point
 * is that containment and quoting can be proven without a filesystem, a repository, or a Windows
 * runner. A real hostile `pnpm install` is **not** covered here — that needs a fixture repo and the
 * Windows branch, and pretending otherwise would be the more dangerous claim.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
	getStageEntriesForPackage,
	isWithin,
	normalizePackageRelativePath,
	quoteForCommand,
	removePath,
} from "./hoistPaths.mjs";

/** A stable absolute directory to test containment against. */
const package_ = path.resolve("/repo/packages/example");

/** A real empty directory, for the cases that need a filesystem to delete from. */
function makeTemporaryDirectory() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "hoist-spec-"));
}

describe("isWithin", () => {
	const cases = [
		["the root itself is not inside itself", package_, package_, false],
		["a direct child is inside", package_, path.join(package_, "dist"), true],
		["a nested child is inside", package_, path.join(package_, "src", "deep", "file.ts"), true],
		["a sibling sharing a prefix is outside", package_, `${package_}-other`, false],
		["a parent is outside", package_, path.join(package_, ".."), false],
		["an escaping .. is outside", package_, path.join(package_, "src", "..", "..", ".."), false],
		["an absolute outsider is outside", package_, path.resolve("/repo/other"), false],
	];

	for (const [name, root, candidate, expected] of cases) {
		test(name, () => {
			assert.equal(isWithin(root, candidate), expected);
		});
	}

	test("the separator boundary is respected", () => {
		/*
		 * The defect this guards: `"/a/bc".startsWith("/a/b")` is true, so a bare prefix test would
		 * call a sibling inside. Both spellings must resolve to `false`.
		 */
		const root = path.resolve("/a/b");

		assert.equal(isWithin(root, path.resolve("/a/bc")), false);
		assert.equal(isWithin(root, path.join(root, "c")), true);
	});
});

describe("normalizePackageRelativePath", () => {
	const accepted = ["src", "./src", "src/index.js", "out", "dist/web/main.js"];
	for (const value of accepted) {
		test(`accepts ${value}`, () => {
			assert.equal(normalizePackageRelativePath(value, package_), value.startsWith("./") ? value.slice(2) : value);
		});
	}

	const rejected = [
		["an interior .. that escapes", "src/../../.."],
		["a doubled interior ..", "src/../.."],
		["a bare parent", ".."],
		["a leading parent", "../x"],
		["an absolute path", "/abs"],
		["a Windows absolute path", "C:/Windows"],
		["a glob", "src/*"],
		["an empty string", ""],
		["a non-string", 42],
	];

	for (const [name, value] of rejected) {
		test(`rejects ${name}`, () => {
			assert.equal(normalizePackageRelativePath(value, package_), undefined);
		});
	}

	test("a single interior .. that stays inside is accepted", () => {
		/*
		 * `src/../dist` resolves to `dist`, which is still the package's own directory. Rejecting it
		 * would be stricter than "relative to the package" means, and a manifest may legitimately
		 * spell a path that way.
		 */
		assert.equal(normalizePackageRelativePath("src/../dist", package_), "src/../dist");
	});
});

describe("getStageEntriesForPackage", () => {
	/*
	 * The staging delete happens before any link is made, so a field that resolves out of the package
	 * must never be *in* this set. The canary is what makes the assertion mean something: a spec that
	 * only checked the returned array would pass even if the escape were still reachable elsewhere.
	 */
	test("an escaping main contributes no entry, and a canary outside the package survives", () => {
		const sandbox = makeTemporaryDirectory();
		const packageDirectory = path.join(sandbox, "packages", "example");
		const canary = path.join(sandbox, "canary");
		fs.mkdirSync(packageDirectory, { recursive: true });
		fs.mkdirSync(canary);
		fs.writeFileSync(path.join(canary, "keep.txt"), "keep");

		const entries = getStageEntriesForPackage(
			{ main: "src/../../..", types: "src/../../.." },
			packageDirectory,
		);

		assert.deepEqual(entries, ["package.json"]);

		/* Nothing above reached a delete: the canary is still there. */
		assert.equal(fs.readFileSync(path.join(canary, "keep.txt"), "utf8"), "keep");
		fs.rmSync(sandbox, { force: true, recursive: true });
	});

	test("a valid main, types, files[], exports and bin are all staged", () => {
		const entries = getStageEntriesForPackage(
			{
				bin: { tool: "bin/cli.js" },
				exports: { ".": { import: "./out/index.js", types: "./out/index.d.ts" } },
				files: ["out", "src"],
				main: "out/init.luau",
				types: "out/init.d.ts",
			},
			package_,
		);

		assert.deepEqual(entries, [
			"bin/cli.js",
			"out",
			"out/index.d.ts",
			"out/index.js",
			"out/init.d.ts",
			"out/init.luau",
			"package.json",
			"src",
		]);
	});

	test("an escaping entry mixed with a valid one drops only the escape", () => {
		const entries = getStageEntriesForPackage(
			{ files: ["out", "../../etc"], main: "out/index.js" },
			package_,
		);

		assert.deepEqual(entries, ["out", "out/index.js", "package.json"]);
	});
});

describe("removePath", () => {
	test("a target outside the root throws instead of deleting", () => {
		const sandbox = makeTemporaryDirectory();
		const root = path.join(sandbox, "stage");
		const outside = path.join(sandbox, "outside");
		fs.mkdirSync(root);
		fs.mkdirSync(outside);
		fs.writeFileSync(path.join(outside, "keep.txt"), "keep");

		assert.throws(() => removePath(outside, root), /outside/u);
		assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep");
		fs.rmSync(sandbox, { force: true, recursive: true });
	});

	test("the root itself is refused, so the caller cannot empty its own stage", () => {
		const sandbox = makeTemporaryDirectory();
		fs.writeFileSync(path.join(sandbox, "keep.txt"), "keep");

		assert.throws(() => removePath(sandbox, sandbox), /outside/u);
		assert.ok(fs.existsSync(path.join(sandbox, "keep.txt")));
		fs.rmSync(sandbox, { force: true, recursive: true });
	});

	test("a prefix sibling of the root is refused", () => {
		const sandbox = makeTemporaryDirectory();
		const root = path.join(sandbox, "stage");
		const sibling = `${root}-other`;
		fs.mkdirSync(root);
		fs.mkdirSync(sibling);
		fs.writeFileSync(path.join(sibling, "keep.txt"), "keep");

		assert.throws(() => removePath(sibling, root), /outside/u);
		assert.ok(fs.existsSync(path.join(sibling, "keep.txt")));
		fs.rmSync(sandbox, { force: true, recursive: true });
	});

	test("a child of the root is deleted, and a missing child is a no-op", () => {
		const sandbox = makeTemporaryDirectory();
		const child = path.join(sandbox, "child");
		fs.mkdirSync(child);

		removePath(child, sandbox);
		assert.equal(fs.existsSync(child), false);
		assert.doesNotThrow(() => removePath(path.join(sandbox, "absent"), sandbox));
		fs.rmSync(sandbox, { force: true, recursive: true });
	});
});

describe("quoteForCommand", () => {
	test("a path with &, a space, and a caret is quoted without doubling the caret", () => {
		/*
		 * Quoting is the whole job. Doubling `^` — the fix a reader expects from cmd escaping — was
		 * measured to corrupt the created directory name, because the argument reaches `mklink` verbatim
		 * rather than through a second parse. The empirical note lives on `quoteForCommand`.
		 */
		const quoted = quoteForCommand("C:\\repo\\a&calc&b ^ c");

		assert.equal(quoted, '"C:\\repo\\a&calc&b ^ c"');
		assert.ok(quoted.startsWith('"') && quoted.endsWith('"'), "the whole path must be one argument");
	});

	test("a plain path is still quoted", () => {
		assert.equal(quoteForCommand("C:\\repo\\packages\\a"), '"C:\\repo\\packages\\a"');
	});

	test("a command separator inside the path cannot split the command", () => {
		/*
		 * `cmd.exe /c` re-parses its tail, so an unquoted `&` would end the `mklink` and run `calc`.
		 * Quoted, every operator is literal.
		 */
		const quoted = quoteForCommand("C:\\repo\\a&calc.exe");

		assert.ok(quoted.includes('"C:\\repo\\a&calc.exe"'));
		assert.equal(quoted.split("&").length, 2, "the & stays inside the quoted argument");
	});
});

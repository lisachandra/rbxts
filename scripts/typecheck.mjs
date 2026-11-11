#!/usr/bin/env node

/*
 * `pnpm typecheck`: sloptor check over the root project and every referenced
 * project.
 *
 * `sloptor check <dir>` type-checks exactly one tsconfig: it reads that
 * project's `include` and ignores `references` entirely, so checking the root
 * alone says nothing about `packages/*` or `test/*`.
 *
 * The reference list is read from the tsconfigs rather than hardcoded, so a
 * package added to either file is covered with no edit. `--json` gives one
 * object per project; each project's diagnostics are re-printed as plain
 * `file:line:col code message` lines so pnpm's output stays greppable and the
 * exit code is a single answer.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");

/**
 * Strip `//` and block comments and trailing commas, then parse.
 *
 * A character scan rather than a regex: a `//` inside a string (a Windows path, a
 * URL) must survive, and only a scanner knows whether it is inside one.
 * @param file - The JSONC file to read.
 * @returns The parsed config.
 */
function readJsonc(file) {
	const raw = readFileSync(file, "utf-8");
	let out = "";
	let inString = false;
	let inLine = false;
	let inBlock = false;
	for (let index = 0; index < raw.length; index++) {
		const char = raw[index];
		if (inLine) {
			if (char === "\n") {
				inLine = false;
				out += char;
			}

			continue;
		}

		if (inBlock) {
			if (char === "*" && raw[index + 1] === "/") {
				inBlock = false;
				index += 1;
			}

			continue;
		}

		if (inString) {
			out += char;
			if (char === "\\") {
				index += 1;
				out += raw[index] ?? "";
			} else if (char === '"') {
				inString = false;
			}

			continue;
		}

		if (char === '"') {
			inString = true;
			out += char;
			continue;
		}

		if (char === "/") {
			if (raw[index + 1] === "/") {
				inLine = true;
				index += 1;
				continue;
			}

			if (raw[index + 1] === "*") {
				inBlock = true;
				index += 1;
				continue;
			}
		}

		out += char;
	}

	return JSON.parse(out.replace(/,\s*([}\]])/g, "$1"));
}

/**
 * The `references` of a tsconfig, resolved against the config's own directory.
 *
 * A reference may name a config *file* (`tsconfig.node.json`, the Node-side
 * build scripts) rather than a directory. `sloptor check` only takes a
 * directory, so those are skipped; they are covered by the Node toolchain
 * instead.
 */
function referencesOf(tsconfigPath) {
	const config = readJsonc(tsconfigPath);
	const references = config.references ?? [];
	return references
		.map((reference) => resolve(dirname(tsconfigPath), reference.path))
		.filter((path) => statSync(path).isDirectory());
}

const solution = referencesOf(resolve(root, "tsconfig.json"));
const projects = [root, ...solution.map((project) => relative(root, project))];

const sloptor = process.env.SLOPTOR_BIN ?? "sloptor";
let failed = 0;

for (const project of projects) {
	const label = project === "." || project === "" ? "<root>" : project;
	const result = spawnSync(sloptor, ["check", project, "--json"], {
		cwd: root,
		encoding: "utf-8",
	});

	if (result.error) {
		console.error(`typecheck: cannot run ${sloptor}: ${result.error.message}`);
		process.exit(1);
	}

	let report;
	try {
		report = JSON.parse(result.stdout);
	} catch {
		// A crash rather than a verdict: no JSON to read, so surface both streams.
		console.error(`typecheck: ${label} produced no result`);
		process.stderr.write(result.stdout);
		process.stderr.write(result.stderr);
		failed++;
		continue;
	}

	if (report.ok) {
		console.log(`ok   ${label}  (${report.files} files)`);
		continue;
	}

	failed++;
	console.error(`FAIL ${label}  (${report.files} files)`);
	for (const diagnostic of report.diagnostics) {
		const where =
			diagnostic.line > 0
				? `${relative(root, diagnostic.file)}:${diagnostic.line}:${diagnostic.col}`
				: diagnostic.file || label;
		console.error(`  ${where}  ${diagnostic.code}  ${diagnostic.message}`);
	}
}

if (failed > 0) {
	console.error(`typecheck: ${failed}/${projects.length} project(s) failed`);
	process.exit(1);
}

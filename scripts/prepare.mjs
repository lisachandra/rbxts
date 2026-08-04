import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_REPO_FRAGMENT = "lisachandra/rbxts";
const PREPARE_LOCKFILE = ".prepare-build.lock";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.dirname(scriptDir);
const prepareLockPath = path.join(repoRoot, PREPARE_LOCKFILE);

function findGitConfig(startDir) {
	let currentDir = startDir;

	while (true) {
		const gitConfigPath = path.join(currentDir, ".git", "config");
		if (existsSync(gitConfigPath)) {
			return gitConfigPath;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return undefined;
		}

		currentDir = parentDir;
	}
}

function getOriginRemoteUrl(configContents) {
	const remoteSectionMatch = configContents.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/);
	if (!remoteSectionMatch) {
		return undefined;
	}

	const urlMatch = remoteSectionMatch[1].match(/^\s*url\s*=\s*(.+)\s*$/m);
	return urlMatch ? urlMatch[1].trim() : undefined;
}

function isCanonicalRbxtsRepo() {
	const gitConfigPath = findGitConfig(process.cwd());
	if (!gitConfigPath) {
		return false;
	}

	let configContents;
	try {
		configContents = readFileSync(gitConfigPath, "utf8");
	} catch {
		return false;
	}

	const originUrl = getOriginRemoteUrl(configContents);
	if (!originUrl) {
		return false;
	}

	return originUrl.includes(CANONICAL_REPO_FRAGMENT);
}

function runScript(scriptRelativePath, args = []) {
	execFileSync("node", [scriptRelativePath, ...args], {
		cwd: repoRoot,
		env: process.env,
		stdio: "inherit",
	});
}

function tryAcquirePrepareLock() {
	try {
		if (existsSync(prepareLockPath)) {
			return undefined;
		}

		const handle = openSync(prepareLockPath, "wx");
		writeFileSync(handle, `${process.pid}\n`, "utf8");
		return handle;
	} catch (err) {
		if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
			return undefined;
		}

		throw err;
	}
}

function runSharedPrepareBuild() {
	const lockHandle = tryAcquirePrepareLock();
	if (lockHandle === undefined) {
		console.warn("@lisachandra/rbxts: Lock already acquired (built)");
		return;
	}

	runScript("./scripts/build.mjs", ["--scope", "all"]);
}

function main() {
	if (isCanonicalRbxtsRepo()) {
		process.exit(0);
	}

	runSharedPrepareBuild();
}

main();

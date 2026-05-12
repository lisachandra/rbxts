import { execFileSync } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync, closeSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_REPO_FRAGMENT = "lisachandra/rbxts";
const PREPARE_LOCKFILE = ".prepare-build.lock";
const PREPARE_DONEFILE = ".prepare-build.done";
const PREPARE_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const PREPARE_WAIT_INTERVAL_MS = 200;

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.dirname(scriptDir);
const prepareLockPath = path.join(repoRoot, PREPARE_LOCKFILE);
const prepareDonePath = path.join(repoRoot, PREPARE_DONEFILE);

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

function sleep(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function runScript(scriptRelativePath, args = []) {
	execFileSync("node", [scriptRelativePath, ...args], {
		cwd: repoRoot,
		stdio: "inherit",
		env: process.env,
	});
}

function tryAcquirePrepareLock() {
	try {
		const handle = openSync(prepareLockPath, "wx");
		writeFileSync(handle, `${process.pid}\n`, "utf8");
		return handle;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
			return undefined;
		}

		throw error;
	}
}

function releasePrepareLock(handle) {
	closeSync(handle);
	if (existsSync(prepareLockPath)) {
		rmSync(prepareLockPath, { force: true });
	}
}

function waitForSharedBuild() {
	const deadline = Date.now() + PREPARE_WAIT_TIMEOUT_MS;

	while (Date.now() < deadline) {
		if (existsSync(prepareDonePath) || !existsSync(prepareLockPath)) {
			return;
		}

		sleep(PREPARE_WAIT_INTERVAL_MS);
	}

	console.warn(`Timed out waiting for shared prepare build lock at ${prepareLockPath}; continuing because another prepare process may have completed successfully.`);
}

function runSharedPrepareBuild() {
	const lockHandle = tryAcquirePrepareLock();
	if (lockHandle === undefined) {
		waitForSharedBuild();
		return;
	}

	try {
		if (existsSync(prepareDonePath)) {
			rmSync(prepareDonePath, { force: true });
		}

		runScript("./scripts/build.mjs", ["--scope", "all"]);
		writeFileSync(prepareDonePath, `${Date.now()}\n`, "utf8");
	} finally {
		releasePrepareLock(lockHandle);
	}
}

function main() {
	if (isCanonicalRbxtsRepo()) {
		process.exit(0);
	}

	runSharedPrepareBuild();
}

main();

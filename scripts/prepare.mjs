import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_REPO_FRAGMENT = "lisachandra/rbxts";
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.dirname(scriptDir);

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

function getCurrentPackageName() {
	const packageJsonPath = path.join(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	if (!packageJson || typeof packageJson.name !== "string" || packageJson.name.length === 0) {
		throw new Error(`Unable to determine package name from ${packageJsonPath}`);
	}

	return packageJson.name;
}

function isRepoRoot(targetPath) {
	return path.resolve(targetPath) === path.resolve(repoRoot);
}

function runScript(scriptRelativePath, args = []) {
	execFileSync("node", [scriptRelativePath, ...args], {
		cwd: repoRoot,
		stdio: "inherit",
		env: process.env,
	});
}

function main() {
	if (isCanonicalRbxtsRepo()) {
		return;
	}

	if (isRepoRoot(process.cwd())) {
		runScript("./scripts/build.mjs", ["--scope", "all"]);
		return;
	}

	const packageName = getCurrentPackageName();
	runScript("./scripts/build.mjs", ["--target", packageName]);
}

main();

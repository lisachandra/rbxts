import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CANONICAL_REPO_FRAGMENT = "lisachandra/rbxts";

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

function shouldSkipPrepareBuild() {
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

process.exit(shouldSkipPrepareBuild() ? 0 : 1);

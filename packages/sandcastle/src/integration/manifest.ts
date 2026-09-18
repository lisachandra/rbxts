/*
 * Manifest lifecycle for integration composition.
 *
 * Owns the integration manifest JSON: path resolution, name validation, read/write
 * handling (pretty-printed with a refreshed `updatedAt`), and creation with git
 * preflight (worktree add + branch existence checks). The filesystem surface is
 * injectable (`ManifestFs`, defaulting to `node:fs`) so tests need no real repo,
 * and the git preflight helpers (`git`/`gitTry`/`resolveCommit`) are injectable too.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import { git, gitTry, resolveCommit } from "../git.js";
import { config, integrationsDir } from "../runtime.js";
import type { IntegrationKind, IntegrationManifest, IntegrationSource } from "../types.js";

/** Injectable filesystem surface for manifest reads/writes. Defaults to `node:fs`. */
export interface ManifestFs {
	existsSync: (path: string) => boolean;
	mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
	readFileSync: (path: string, encoding: "utf-8") => string;
	writeFileSync: (path: string, data: string, encoding: "utf-8") => void;
}

const defaultFs: ManifestFs = { existsSync, mkdirSync, readFileSync, writeFileSync };

export const integrationBranch = (name: string): string => `sandcastle/integration/${name}`;

export function integrationManifestPath(name: string): string {
	return pathResolve(integrationsDir, name, "manifest.json");
}

export function assertIntegrationName(name: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
		throw new Error(
			`Invalid integration name ${JSON.stringify(name)}; use letters, numbers, ., _, or -`,
		);
	}
}

export function readIntegrationManifest(
	name: string,
	fs: ManifestFs = defaultFs,
): undefined | IntegrationManifest {
	const path = integrationManifestPath(name);
	if (!fs.existsSync(path)) {
		return undefined;
	}

	try {
		return JSON.parse(fs.readFileSync(path, "utf-8")) as IntegrationManifest;
	} catch {
		throw new Error(`Integration manifest is invalid: ${path}`);
	}
}

export function writeIntegrationManifest(
	manifest: IntegrationManifest,
	fs: ManifestFs = defaultFs,
): void {
	const path = integrationManifestPath(manifest.name);
	fs.mkdirSync(dirname(path), { recursive: true });
	manifest.updatedAt = new Date().toISOString();
	fs.writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`, "utf-8");
}

export function integrationBasePath(manifest: IntegrationManifest): string {
	return pathResolve(integrationsDir, manifest.name, "worktree");
}

export function createIntegrationManifest(
	name: string,
	kind: IntegrationKind,
	baseRef: string,
	sources: Array<IntegrationSource>,
	allowUnreviewed: boolean,
	deps: {
		fs?: ManifestFs;
		git?: typeof git;
		gitTry?: typeof gitTry;
		resolveCommit?: typeof resolveCommit;
	} = {},
): IntegrationManifest {
	const fs = deps.fs ?? defaultFs;
	const gitCmd = deps.git ?? git;
	const gitTryCmd = deps.gitTry ?? gitTry;
	const resolveCommitCmd = deps.resolveCommit ?? resolveCommit;

	assertIntegrationName(name);
	if (readIntegrationManifest(name, fs)) {
		throw new Error(
			`Integration ${JSON.stringify(name)} already exists; use integration-resume or choose another name.`,
		);
	}

	const now = new Date().toISOString();
	const manifest: IntegrationManifest = {
		allowUnreviewed: allowUnreviewed || undefined,
		base: { commit: "", ref: baseRef },
		branch: integrationBranch(name),
		createdAt: now,
		kind,
		name,
		sources: sources.map((source, index) => ({ ...source, order: index + 1 })),
		status: "created",
		updatedAt: now,
		worktree: `${config.dir}/integrations/${name}/worktree`,
	};

	try {
		manifest.base.commit = resolveCommitCmd(baseRef);
		if (
			gitTryCmd(["show-ref", "--verify", "--quiet", `refs/heads/${manifest.branch}`]) !==
			undefined
		) {
			throw new Error(`Branch ${manifest.branch} already exists.`);
		}

		if (fs.existsSync(integrationBasePath(manifest))) {
			throw new Error(`Worktree path already exists: ${integrationBasePath(manifest)}`);
		}

		writeIntegrationManifest(manifest, fs);
		fs.mkdirSync(dirname(integrationBasePath(manifest)), { recursive: true });
		gitCmd([
			"worktree",
			"add",
			"-b",
			manifest.branch,
			integrationBasePath(manifest),
			manifest.base.commit,
		]);
	} catch (err) {
		manifest.status = "preflight-failed";
		manifest.lastError = String(err);
		writeIntegrationManifest(manifest, fs);
		throw err;
	}

	return manifest;
}

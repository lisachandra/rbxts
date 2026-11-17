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
import { dirname, isAbsolute, resolve as pathResolve } from "node:path";
import { z } from "zod";

import { assertWithin } from "../containment.js";
import { commitExists, git, gitTry, issueBranch, resolveCommit } from "../git.js";
import { config, integrationsDir, logsDir, stateRoot } from "../runtime.js";
import { getLatestReviewMarker, isReviewComplete, readState } from "../state.js";
import type {
	IntegrationKind,
	IntegrationManifest,
	IntegrationSource,
	IntegrationStatus,
} from "../types.js";

/** Injectable filesystem surface for manifest reads/writes. Defaults to `node:fs`. */
export interface ManifestFs {
	existsSync: (path: string) => boolean;
	mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
	readFileSync: (path: string, encoding: "utf-8") => string;
	writeFileSync: (path: string, data: string, encoding: "utf-8") => void;
}

const defaultFs: ManifestFs = { existsSync, mkdirSync, readFileSync, writeFileSync };

export const integrationBranch = (name: string): string => `sandcastle/integration/${name}`;

/**
 * Integration names are branch names: letters, numbers, `.`, `_`, and `-`, never a leading dot or
 * dash. The queue's batch names are integration names, so both validators read this one pattern.
 */
export const integrationNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function assertIntegrationName(name: string): void {
	if (!integrationNamePattern.test(name)) {
		throw new Error(
			`Invalid integration name ${JSON.stringify(name)}; use letters, numbers, ., _, or -`,
		);
	}
}

/**
 * - Absolute path of an integration's `manifest.json`.
 * - @param name - Integration name.
 * - @returns `<integrationsDir>/<name>/manifest.json`.
 * - @throws {Error} When `name` is not an integration name, or the result is not inside the
 *   integrations directory.
 * - @remarks The pattern already implies containment; the check is here because this is one of the
 *   four sinks a name reaches, and the seam's contract is that a path builder refuses rather than
 *   trusting whatever validation happened earlier.
 */
export function integrationManifestPath(name: string): string {
	assertIntegrationName(name);
	return assertWithin(
		integrationsDir,
		pathResolve(integrationsDir, name, "manifest.json"),
		"integration manifest",
	);
}

/**
 * - Absolute path of an integration's agent log.
 * - @param name - Integration name.
 * - @returns `<logsDir>/integration-<name>.log`.
 * - @throws {Error} When `name` is not an integration name, or the result is not inside the logs
 *   directory.
 * - @remarks The log is appended to by the resolve and review agents, so a name that escapes turns an
 *   agent's output into a write anywhere the runner can reach. Both call sites share this one
 *   builder so they cannot disagree about the name.
 */
export function integrationLogPath(name: string): string {
	assertIntegrationName(name);
	return assertWithin(
		logsDir,
		pathResolve(logsDir, `integration-${name}.log`),
		"integration log",
	);
}

const integrationSourceSchema = z.object({
	branch: z.string().min(1),
	commit: z.string().min(1),
	issue: z.string().optional(),
	name: z.string().min(1),
	order: z.number(),
});

const integrationManifestSchema = z
	.object({
		allowUnreviewed: z.boolean().optional(),
		base: z.object({ commit: z.string(), ref: z.string().min(1) }),
		branch: z.string().min(1),
		createdAt: z.string().min(1),
		currentSource: z.number().optional(),
		headCommit: z.string().optional(),
		kind: z.enum(["issues", "integrations"]),
		lastError: z.string().optional(),
		/*
		 * A name is a path segment in four places — the manifest's own directory, the marker, the review
		 * log, and the worktree — so it is validated as a branch-safe name here rather than at each sink.
		 * The CLI argument already went through this pattern; the gap was that file content did not.
		 */
		name: z.string().regex(integrationNamePattern, "must be an integration name"),
		reviewHead: z.string().optional(),
		sources: z.array(integrationSourceSchema),
		status: z.enum([
			"created",
			"merging",
			"aborted",
			"blocked",
			"reviewing",
			"integrated",
			"review-passed",
			"review-failed",
			"preflight-failed",
			"ready-for-human-merge",
			"conflict-resolution-required",
		]),
		updatedAt: z.string().min(1),
		/*
		 * Relative, because it is resolved against the integrations root. An absolute value used to
		 * replace the root entirely — `path.resolve(stateRoot, "C:/Windows")` is `C:Windows` — which put
		 * an arbitrary directory in reach of `removeWorktree`.
		 */
		worktree: z.string().refine((value) => !isAbsolute(value), "must be a relative path"),
	})
	.passthrough();

function firstIssueMessage(error: z.ZodError): string {
	const issue = error.issues[0];
	if (issue === undefined) {
		return "unknown schema error";
	}

	return `${issue.path.join(".") || "(root)"}: ${issue.message}`;
}

export function readIntegrationManifest(
	name: string,
	fs: ManifestFs = defaultFs,
): undefined | IntegrationManifest {
	const path = integrationManifestPath(name);
	if (!fs.existsSync(path)) {
		return undefined;
	}

	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(path, "utf-8"));
	} catch {
		throw new Error(`Integration manifest is invalid: ${path}`);
	}

	const parsed = integrationManifestSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`Integration manifest is invalid: ${path} (${firstIssueMessage(parsed.error)})`,
		);
	}

	return parsed.data as IntegrationManifest;
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

/**
 * - Absolute path of an integration worktree.
 * - @param name - Integration name.
 * - @param fs - Filesystem used to spot a pre-rename directory; defaults to `node:fs`.
 * - @returns The worktree path under the integrations directory.
 * - @remarks The directory is named after the integration rather than `worktree`, because `git
 *   worktree add` registers a worktree under the **basename** of its path: a fixed `worktree`
 *   basename made every integration collide in `.git/worktrees`, and git disambiguated them into
 *   `worktree4`, `worktree5`, and so on — unreadable registrations that outlive the worktree they
 *   name. A `worktree` directory left by an earlier run is still that integration's worktree, so it
 *   keeps resolving; only new integrations get the unambiguous name.
 */
export function integrationWorktreePath(
	name: string,
	fs: Pick<ManifestFs, "existsSync"> = defaultFs,
): string {
	const named = pathResolve(integrationsDir, name, name);
	const legacy = pathResolve(integrationsDir, name, "worktree");
	return fs.existsSync(legacy) && !fs.existsSync(named) ? legacy : named;
}

/**
 * - Absolute path of the worktree an integration manifest records.
 * - @param manifest - Integration manifest.
 * - @param fs - Filesystem used to spot a pre-rename directory; defaults to `node:fs`.
 * - @returns The recorded worktree path when the manifest carries one, otherwise a derived path.
 * - @remarks The recorded path wins so a manifest written before the rename keeps pointing at the
 *   directory that actually holds its composition, rather than at a path nothing created.
 */
export function integrationBasePath(
	manifest: IntegrationManifest,
	fs: Pick<ManifestFs, "existsSync"> = defaultFs,
): string {
	const recorded = manifest.worktree;
	if (recorded !== undefined && recorded !== "") {
		/*
		 * Inside *this* integration's own directory, not merely somewhere under the integrations root.
		 * The wider root would let one integration's manifest point at a sibling's worktree, so
		 * cleaning `a` would delete `b` — a containment check that passes while the redirect it exists
		 * to stop still happens. An absolute value replaces the root in `path.resolve`; the schema
		 * refuses one on read, so this is the second lock on the same door, and the one that also
		 * catches a relative path climbing out with `..`.
		 */
		return assertWithin(
			assertWithin(
				integrationsDir,
				pathResolve(integrationsDir, manifest.name),
				"integration directory",
			),
			pathResolve(stateRoot, recorded),
			"integration worktree",
		);
	}

	return integrationWorktreePath(manifest.name, fs);
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
		worktree: `${config.dir}/integrations/${name}/${name}`,
	};

	try {
		manifest.base.commit = resolveCommitCmd(baseRef);
		if (
			gitTryCmd(["show-ref", "--verify", "--quiet", `refs/heads/${manifest.branch}`]) !==
			undefined
		) {
			throw new Error(`Branch ${manifest.branch} already exists.`);
		}

		const worktree = integrationBasePath(manifest, fs);
		if (fs.existsSync(worktree)) {
			throw new Error(`Worktree path already exists: ${worktree}`);
		}

		writeIntegrationManifest(manifest, fs);
		fs.mkdirSync(dirname(worktree), { recursive: true });
		gitCmd(["worktree", "add", "-b", manifest.branch, worktree, manifest.base.commit]);
	} catch (err) {
		manifest.status = "preflight-failed";
		manifest.lastError = String(err);
		writeIntegrationManifest(manifest, fs);
		throw err;
	}

	return manifest;
}

const integrationReviewStatuses: ReadonlySet<IntegrationStatus> = new Set([
	"ready-for-human-merge",
	"review-passed",
]);

/**
 * Resolve an approved issue branch as an integration source, gated on review completion and an
 * APPROVED review marker unless `allowUnreviewed` is set.
 */
export function resolveIssueIntegrationSource(
	issueNumber: string,
	allowUnreviewed: boolean,
	deps: {
		getLatestReviewMarker?: typeof getLatestReviewMarker;
		readState?: typeof readState;
		resolveCommit?: typeof resolveCommit;
	} = {},
): IntegrationSource {
	const readStateCmd = deps.readState ?? readState;
	const branch = issueBranch(issueNumber);
	const state = readStateCmd(issueNumber);
	if (!allowUnreviewed && !isReviewComplete(state)) {
		throw new Error(
			`Cannot integrate issue #${issueNumber}: its review phase is not complete. Use --allow-unreviewed to override.`,
		);
	}

	if (!allowUnreviewed) {
		const marker = (deps.getLatestReviewMarker ?? getLatestReviewMarker)(issueNumber);
		if (marker !== "APPROVED") {
			throw new Error(
				`Cannot integrate issue #${issueNumber}: latest review marker is ${marker ?? "missing"}; expected APPROVED.`,
			);
		}
	}

	const commit = (deps.resolveCommit ?? resolveCommit)(branch);
	return { branch, commit, issue: issueNumber, name: `issue-${issueNumber}`, order: 0 };
}

/**
 * Resolve an existing, previously integrated integration as a source, verifying its status and that
 * its recorded commit still exists and the branch has not moved.
 */
export function resolveExistingIntegrationSource(
	name: string,
	allowUnreviewed: boolean,
	deps: {
		commitExists?: typeof commitExists;
		readIntegrationManifest?: typeof readIntegrationManifest;
		resolveCommit?: typeof resolveCommit;
	} = {},
): IntegrationSource {
	assertIntegrationName(name);
	const readManifest = deps.readIntegrationManifest ?? readIntegrationManifest;
	const source = readManifest(name);
	if (!source) {
		throw new Error(`Integration ${JSON.stringify(name)} does not exist.`);
	}

	if (!allowUnreviewed && !integrationReviewStatuses.has(source.status)) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: status is ${source.status}. Use --allow-unreviewed to override.`,
		);
	}

	const commitExistsCmd = deps.commitExists ?? commitExists;
	if (
		source.headCommit !== undefined &&
		source.headCommit !== "" &&
		!commitExistsCmd(source.headCommit)
	) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: recorded commit ${source.headCommit} no longer exists.`,
		);
	}

	const currentCommit = (deps.resolveCommit ?? resolveCommit)(source.branch);
	if (
		source.headCommit !== undefined &&
		source.headCommit !== "" &&
		currentCommit !== source.headCommit
	) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: branch moved since its manifest was recorded.`,
		);
	}

	if (!commitExistsCmd(currentCommit)) {
		throw new Error(
			`Cannot compose ${JSON.stringify(name)}: branch commit ${currentCommit} no longer exists.`,
		);
	}

	return { branch: source.branch, commit: currentCommit, name, order: 0 };
}

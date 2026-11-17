import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, test } from "vitest";

import {
	assertCommitSigned,
	type CommitSigningPolicy,
	readCommitSigningPolicy,
	signingArgs,
	UnsignedCommitError,
} from "./signing.js";
import { gitStub, registerTestHooks, tmpRoot } from "./test-helpers.js";

registerTestHooks();

const createdDirs: Array<string> = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

const REQUIRED: CommitSigningPolicy = { required: true, source: "commit.gpgsign=true" };
const NOT_REQUIRED: CommitSigningPolicy = { required: false, source: "commit.gpgsign is unset" };

/** Collects every `git` argv a case runs, so "did it verify?" is answered from the arguments. */
function recordingGit(handlers: { config?: string; status?: string }): Array<Array<string>> {
	const calls: Array<Array<string>> = [];
	gitStub({
		file: (args) => {
			calls.push([...args]);
			if (args[0] === "config") {
				return handlers.config ?? "";
			}

			if (args[0] === "log") {
				return handlers.status ?? "";
			}

			return "";
		},
	});
	return calls;
}

describe("readCommitSigningPolicy", () => {
	test("should report required when commit.gpgsign is true", () => {
		recordingGit({ config: "true" });

		assert.deepEqual(readCommitSigningPolicy(), {
			required: true,
			source: "commit.gpgsign=true",
		});
	});

	test("should report not required when commit.gpgsign is false", () => {
		// The throwaway-repository case: the suite disables signing, and that must not read as a policy.
		recordingGit({ config: "false" });

		assert.deepEqual(readCommitSigningPolicy(), {
			required: false,
			source: "commit.gpgsign=false",
		});
	});

	test("should report not required when commit.gpgsign is unset", () => {
		// An absent setting is not a policy; treating it as one would fail on every fresh clone.
		recordingGit({ config: "" });

		assert.equal(readCommitSigningPolicy().required, false);
	});

	test("should let a throwaway repository's local false override a global true", () => {
		/*
		 * The case the whole suite depends on. A host with global `commit.gpgsign=true` — this one has
		 * it — and a throwaway repository that sets `false` locally: the policy read has to answer
		 * "not required", or every test that creates a repository would fail trying to sign a commit
		 * with no key. The read deliberately omits `--local` so git resolves the precedence, and this
		 * pins that decision against a real repository rather than a stub.
		 */
		const root = resolve(tmpRoot, "signing-policy", "throwaway");
		rmSync(root, { force: true, recursive: true });
		mkdirSync(root, { recursive: true });
		createdDirs.push(root);
		const git = (args: ReadonlyArray<string>, cwd = root): void => {
			execFileSync("git", [...args], { cwd, stdio: "pipe" });
		};

		git(["init", "-q", "-b", "main"]);
		git(["config", "commit.gpgsign", "false"]);

		assert.equal(readCommitSigningPolicy(root).required, false);
		assert.equal(readCommitSigningPolicy(root).source, "commit.gpgsign=false");
	});
});

describe("assertCommitSigned", () => {
	test("should throw naming the commit subject when a required signature is missing", () => {
		const calls = recordingGit({ status: "N" });

		assert.throws(
			() => {
				assertCommitSigned("docs(sandcastle): add plan for #41", REQUIRED);
			},
			(error: Error) => {
				assert.ok(error instanceof UnsignedCommitError, "a caller can tell this apart");
				assert.match(error.message, /add plan for #41/u);
				assert.match(error.message, /commit\.gpgsign=true/u);
				assert.match(error.message, /do not push/u);

				return true;
			},
		);
		assert.ok(
			calls.some((args) => args[0] === "log"),
			"the status of the created commit was checked",
		);
	});

	test("should accept a good signature, and one whose key trust is unknown", () => {
		// `U` is a good signature from an untrusted key: the signer-trust question, not the signing one.
		for (const status of ["G", "U"]) {
			recordingGit({ status });

			assert.doesNotThrow(() => {
				assertCommitSigned("chore(queue): stamp the batch", REQUIRED);
			});
		}
	});

	test("should refuse a bad signature and say what it saw", () => {
		recordingGit({ status: "B" });

		assert.throws(
			() => {
				assertCommitSigned("chore(queue): stamp the batch", REQUIRED);
			},
			(error: Error) => {
				assert.match(error.message, /%G\?="B"/u);

				return true;
			},
		);
	});

	test("should not verify a commit when signing is not required", () => {
		const calls = recordingGit({ status: "N" });

		assert.doesNotThrow(() => {
			assertCommitSigned("docs(sandcastle): add plan for #41", NOT_REQUIRED);
		});
		assert.deepEqual(calls, [], "a repository with signing off never reaches the verification");
	});
});

describe("signingArgs", () => {
	test("should ask git to sign when the host requires it", () => {
		assert.deepEqual(signingArgs(REQUIRED), ["--gpg-sign"]);
	});

	test("should add nothing when the host does not require it", () => {
		assert.deepEqual(signingArgs(NOT_REQUIRED), []);
	});
});

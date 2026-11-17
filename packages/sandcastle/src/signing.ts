/*
 * Signing policy for the commits this runner creates.
 *
 * On 2026-10-27 `main` carried 9 unsigned commits out of 158, all from the automated commit paths,
 * and removing them cost a rewrite of 18 commits and a force-push. Nothing stripped a signature
 * deliberately: the host said `commit.gpgsign=true`, the agent context's git did not see it take
 * effect, and an unsigned result was never detected.
 *
 * Two halves, because detection alone does not prevent that: the commit is asked to sign explicitly,
 * so it does not depend on ambient configuration surviving into whatever shell ran git, and the result
 * is verified afterwards, so a signature that silently did not happen stops the run.
 *
 * The policy is read, never assumed. The suite builds throwaway repositories with signing disabled,
 * and a hardcoded `required: true` would make every one of them fail.
 */

import { gitTry } from "./git.js";
import { repoRoot } from "./runtime.js";

/** Why a commit was signed or not, so the refusal can quote the setting that was in force. */
export interface CommitSigningPolicy {
	/** Whether the host requires a signature on commits. */
	required: boolean;
	/** The setting the answer came from, e.g. `commit.gpgsign=true`. */
	source: string;
}

/**
 * A commit the host required to be signed came out unsigned, or with a signature that does not
 * verify.
 *
 * @remarks
 *   A distinct class because the commit sites are best-effort: they warn and continue when a commit
 *   could not be created at all, and an operator can make that one by hand. This failure is not
 *   that. The commit exists and the record it carries is missing the signature the host policy
 *   requires, so continuing leaves exactly the state that cost a history rewrite, and the caller
 *   must rethrow rather than warn.
 */
export class UnsignedCommitError extends Error {
	public override name = "UnsignedCommitError";
}

/**
 * - Reads the effective signing policy.
 * - @param cwd - Repository to ask; defaults to this checkout.
 * - @returns Whether a signature is required, and the setting that decided it.
 * - @remarks `git config` without `--local` reports the value that actually applies, so a
 *   repository-level `false` overriding a global `true` is seen as the host sees it. An unset value
 *   means "not required": absent configuration is not a policy.
 */
export function readCommitSigningPolicy(cwd = repoRoot): CommitSigningPolicy {
	const configured = (gitTry(["config", "--get", "commit.gpgsign"], cwd) ?? "").trim();
	if (configured === "") {
		return { required: false, source: "commit.gpgsign is unset" };
	}

	/*
	 * Git reads this as a boolean, not as the literal string "true": `yes`, `on`, `1` and an empty
	 * value are all true, and only `false`/`no`/`off`/`0` are false. Matching the literal `"true"` read
	 * a host that spells it `yes` as "not required", which then skipped both the signing flag and the
	 * post-commit verification — the silent-unsigned outcome this policy exists to prevent. An
	 * unrecognized value is treated as required, because refusing to commit beats committing unsigned.
	 */
	const explicitlyFalse = new Set(["0", "false", "no", "off"]);

	return {
		required: !explicitlyFalse.has(configured.toLowerCase()),
		source: `commit.gpgsign=${configured}`,
	};
}

/**
 * - Refuses a commit whose signature does not satisfy a required policy.
 * - @param subject - The commit's subject, so the refusal names the commit rather than `HEAD`.
 * - @param policy - The policy read for this repository.
 * - @param cwd - Repository holding the commit; defaults to this checkout.
 * - @throws {UnsignedCommitError} When a signature is required and `HEAD`'s does not verify.
 * - @remarks Returns without running git when a signature is not required, so a repository that
 *   disabled signing — every throwaway test repository — never reaches the verification. When one
 *   is required, `%G?` is the check rather than `git verify-commit`: `verify-commit` exits non-zero
 *   for a good signature made with a key this machine does not trust, so it would refuse a commit
 *   that _is_ signed. Whether the remote signer's key is trusted here is a different question from
 *   whether the commit carries a signature. `G` and `U` are therefore both accepted, and everything
 *   else (`N` unsigned, `B` bad, `R` revoked, `X`/`Y` expired, `E` uncheckable) is refused by name
 *   so the message says what git saw.
 */
export function assertCommitSigned(
	subject: string,
	policy: CommitSigningPolicy,
	cwd = repoRoot,
): void {
	if (!policy.required) {
		return;
	}

	const status = (gitTry(["log", "-1", "--format=%G?"], cwd) ?? "").trim();
	if (status === "G" || status === "U") {
		return;
	}

	throw new UnsignedCommitError(
		`Commit ${JSON.stringify(subject)} is not signed, but this host requires signatures (${policy.source}). ` +
			`git reports %G?=${JSON.stringify(status)}. ` +
			"The commit was created; do not push it. Rewrite it with `git commit --amend -S` once a signing key is available, " +
			"or set `commit.gpgsign=false` if this repository does not require signatures.",
	);
}

/**
 * - The commit arguments for a repository whose policy is `policy`.
 * - @param policy - The policy read for this repository.
 * - @returns The signing flag when required, or an empty list.
 * - @remarks Passing `--gpg-sign` is what stops the signature depending on ambient configuration: the
 *   runner hands git the flag on its own argv, so a shell that never loaded the host's config
 *   cannot drop it. Verification still runs afterwards — a flag asks, it does not prove.
 */
export function signingArgs(policy: CommitSigningPolicy): Array<string> {
	return policy.required ? ["--gpg-sign"] : [];
}

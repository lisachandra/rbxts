---
"@lisachandra/sandcastle": patch
---

fix(sandcastle): fail loudly when an automated commit is created unsigned

On 2026-10-27 `main` held 9 unsigned commits out of 158, all from the three automated commit paths,
and removing them needed a rewrite of 18 commits and a force-push. Nothing stripped a signature
deliberately: the host said `commit.gpgsign=true`, the agent context's git did not see it take
effect, and an unsigned result was never detected.

Both halves are now closed. Each site asks git to sign on its own argv (`--gpg-sign`), so the
signature no longer depends on ambient configuration surviving into whatever shell ran git; and each
verifies the commit it created with `%G?`, because a flag asks and does not prove.

`%G?` rather than `git verify-commit` is deliberate: `verify-commit` exits non-zero for a good
signature made with a key the machine does not trust, so it would refuse a commit that _is_ signed.
`G` and `U` are accepted; `N`, `B`, `R`, `X`, `Y`, and `E` are refused with what git reported.

The failure is a distinct `UnsignedCommitError`, and the commit sites rethrow it rather than warn.
Every other failure there is best-effort — an operator can make the commit by hand — but this one is
not: the commit exists and is missing what the host policy requires, so continuing leaves exactly the
state that cost the history rewrite.

The policy is read, never assumed, from the effective `commit.gpgsign` (no `--local`, so git resolves
precedence). That is what keeps the suite's throwaway repositories working: they set
`commit.gpgsign=false` locally, which overrides this host's global `true`, and a hardcoded
`required: true` would have made every one of them fail trying to sign without a key.

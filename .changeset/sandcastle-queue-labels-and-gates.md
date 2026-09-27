---
"@lisachandra/sandcastle": minor
---

Add readable batch labels and enforceable run-order gates to the queue manifest.

- `sequences[].title` and `sequences[].roles` label a batch and its members. `queue list` renders
  the title beside the batch name, a role phrase beside each issue number, and every `notes` line
  under the membership — the readable half of the queue used to be invisible in the live view.
- `sequences[].afterMerge` is a declared run-order gate: the batch stays GATED until that
  integration has been composed **and** its head commit is an ancestor of the base branch. It is
  evaluated in `queue/gates.ts` with `git merge-base --is-ancestor`, it fails closed, and it
  replaces the prose "runs only after X merged" that `queue run` never read.
- `gated[].joins` names the batch an issue moves into. `queue promote` prefers it over the issue
  title's conventional scope, and a re-gate keeps it instead of dropping the target.
- `defineSequence` keeps `afterMerge`, `notes`, `roles`, and `title` when a redefinition omits the
  flag, so `queue sequence --issues <a,b,c>` no longer strips a batch's labels.
- New flags: `queue sequence --title <label> --roles <n=role,...> --after-merge <integration>`, and
  `queue add --joins <batch>`.

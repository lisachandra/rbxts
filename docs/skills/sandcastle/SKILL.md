---
name: sandcastle
description: Fire, land, and plan Sandcastle work batches — run the next READY batch, compose its integration branch and pull request, and register review follow-ups in the queue manifest. Use for any sandcastle batch work or batch planning, and whenever a review files follow-up issues.
---

# Sandcastle

Sandcastle runs batches of `ready-for-agent` GitHub issues through three phases — design →
implement → review — each on its own worktree, then composes the batch into a single
**integration branch** and hands you a pull request to merge. GitHub stays canonical for issue
state. A **batch** is a named group of issues that run in order; its **name** is also its
integration: `sandcastle/integration/<name>`.

Two artifacts matter:

- **The queue manifest** — `sandcastle.queue.json` at the repo root, git-tracked. It records
  only what GitHub cannot say: batch composition and run order, gates, same-file rules. Never
  hand-edit it; every change goes through `pnpm sandcastle queue`.
- **The live view** — `pnpm sandcastle queue list`. It reads GitHub and the manifest together and
  is the only thing that shows READY, GATED, and drift. Read the queue through it, not by opening
  the JSON.

## Leading words

- **Batch** — a named sequence of issues, run in order; `name` IS the integration name.
- **Ready** — every member is open and `ready-for-agent`, and no blocker outside the batch is open.
- **Gated** — a declared wait. `after <batch>` holds a batch until that integration has landed on
  the base branch; `queue add --gated` holds one issue until its condition clears. Gates are not
  drift, and `queue run` passes over them silently.
- **Drift** — the queue and GitHub disagreeing about reality: a `ready-for-agent` issue in no
  batch, a batch naming a closed issue, an `after` naming a batch that no longer exists. Fix drift
  before firing anything.
- **Land** — compose a batch's integration (merging members, resolving conflicts, reviewing the
  result) and open its PR. **Merging that PR is the human's act**; sandcastle never merges to the
  base branch.

## The rule that makes the rest simple

**Every batch branches from the base ref.** No batch ever stacks on another batch's unlanded
work, so "when do I merge?" has one answer: when its PR is open and you have reviewed it. A batch
that reads an earlier batch's commits says so with `--after <batch>` and stays GATED until that
integration is an ancestor of the base — `src/queue/gates.ts` is the only place that answers this,
by `git merge-base --is-ancestor`, and it fails closed:

| Integration state                                     | Gate                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| manifest missing                                      | `waiting on integration "x" - it has not been composed yet`     |
| composition unfinished (created, merging, blocked, …) | `waiting on integration "x" - composition status is <status>`   |
| composed, head not yet on the base branch             | `waiting on integration "x" to land on <base> - merge it first` |
| composed and landed                                   | gate open, the batch is READY                                   |

Prose such as "runs only after X merges" is a bug: the scheduler cannot read it, so the batch
fires as soon as its members are labelled. If you write that sentence, write `--after X` instead.

## Invocation

Two modes, one per question. Neither is started by hand-editing files.

### Fire and land

The queue is shaped; now work it. One step per batch, and each ends with something visible.

1. **See what is takeable.** `pnpm sandcastle queue list`. If a batch shows `READY`, it can fire.
2. **Fire it.** `pnpm sandcastle queue run` — or `--name <batch>` for one in particular, or
   `--land` to compose each batch as it finishes. `run` re-reads the manifest and GitHub after
   every batch, so a follow-up registered mid-run changes what fires next in the same invocation.
   Completion: the batch's members have run all three phases.
3. **Land it.** `pnpm sandcastle queue land --name <batch>`. Composing is automatic — conflict
   resolution and integration review are agents — and re-running `land` resumes an unfinished
   composition rather than restarting it. By default it **prints** the `git push` and `gh pr
create` commands; `--create-pr` runs them for you. Either way, the PR body carries one
   `Closes #<n>` per member.
4. **Merge it — this is the human step.** Review the PR and merge it. Every member issue closes
   with it, which is also what clears their `blocked-by` edges for later batches. Nothing in
   sandcastle does this for you.
5. **Let the queue notice.** Once the merge is an ancestor of the base branch, batches with
   `--after <batch>` become READY on their own; the next `queue run` skips landed members and
   drops the batch. `queue land --name <batch> --finish` does the cleanup explicitly, and
   `--dry-run` reports it first.

### Shape the queue

New work has arrived, or a review filed follow-ups.

1. **Read the current shape.** `pnpm sandcastle queue list` — READY/GATED plus drift.
2. **Place the work.** `queue bootstrap` proposes placements for the unplaced backlog
   (`--apply` writes them, `--dry-run` reports). By hand: `queue add --issue <n> --sequence
<batch>` to join a batch, `--gated --reason "<condition>"` for a wait, `--human --reason "..."`
   for a decision session a human must sit in.
3. **Shape the batch.** `pnpm sandcastle queue sequence --name <integration-work> --issues
<a,b,c>` sets membership in run order, with `--after <batch>` for a run-order gate, `--title`,
   `--roles <n=role,...>`, and `--notes`.
4. **Serialize same-file work.** `pnpm sandcastle queue rule --name R<n> --issues <a,b> --reason
"..."` for anything that must never be in flight together.
5. **Check.** `pnpm sandcastle queue check` must report **no drift** before a batch fires — it
   exits 1 on drift and 2 when `--strict-gates` also finds a stale gate.
6. **Hand the graph to a human** when a decision is needed: `pnpm sandcastle queue graph` renders
   run order, gates, and rules as Mermaid (works in any GitHub comment), `--write <path>` commits
   a diffable page, `queue serve` opens it as a local page.

## Rules

- **Order inside a batch is a dependency statement**: each member's branch becomes the next
  member's base, so later members contain earlier commits. Set the order when you define the
  batch; a redefinition keeps its position unless `--before` or `--last` moves it.
- **Append, don't shrink.** An issue whose only open blockers are earlier `ready-for-agent` members
  of a batch belongs _in_ that batch — position satisfies the edge, because the harness never reads
  GitHub's edges. Never append to make the queue look shorter.
- **One name, one batch.** A batch name is unique and is the integration name, so two batches can
  never share a branch; folding two into one is a `queue sequence` edit, not a note.
- **`--after` self-clears.** A gate opens when the integration lands; `--gated` on an issue needs
  `queue promote` (`--apply` promotes every gate that has come ready), and `--human` never
  auto-promotes.
- **Never queue a `wayfinder:grilling` issue.** A grilling is a human decision session — `--human`
  — not an agent run.

## Review follow-ups (the contract that keeps the queue honest)

The most common failure mode is a review that finds extra work, files issues, and stops; the queue
never learns about them. When you run any review — a sandcastle phase or a manual `/code-review`:

1. File each follow-up as a GitHub issue (conventional title, milestone, labels, parent/blocker
   edges per `docs/agents/issue-tracker.md`).
2. Register it in the same change: `queue add --issue <n> --sequence <batch>` — or `--gated
--reason` / `--human --reason`. Add an `R<n>` rule for a new same-file collision.
3. Run `pnpm sandcastle queue check` and get **no drift**. With `queue.commit: true` the mutating
   commands commit the manifest themselves (never push); otherwise commit it, so the registration
   survives the worktree it was made in.

A review that lists follow-ups in a comment but leaves the queue untouched is incomplete: the
queue is the runnable artifact, the comment is only the report.

## Reading further

This file is the tracked source of truth. `.agents/skills/sandcastle` is a gitignored symlink to
this directory, so every repo linking its `.agents` here reads the same file.

- `pnpm sandcastle queue <subcommand> --help` — per-command usage, flags, exit codes
  (`src/help.ts` holds the topics).
- `packages/sandcastle/README.md` — the runner itself: phases, worktrees, integrations.
- `src/queue/` — the implementation, module by module: `manifest.ts` (schema and version gate),
  `migrate.ts` (the v1 → v2 translation), `gates.ts` (gate evaluation), `land.ts` (composition and
  the PR handoff), `run.ts` (dispatch).
- `packages/sandcastle/src/prompts/queue.ts` (`{{QUEUE_RULES}}`) — the review contract as the agents
  see it; override it with that placeholder, never with hard-coded queue instructions.

## Bypass

A repo that does not want the queue workflow sets `queue.enabled: false` in `sandcastle.config.ts`,
or passes `--no-queue` for one invocation (`--queue` re-enables it, `--queue-commit` opts into
committing the manifest). Reviews then report follow-ups in the issue comment only and no queue
gate applies.

## Dispatch safety (what `queue run` guarantees)

- **One dispatcher per checkout.** A run lock means two runs cannot overlap, so the in-memory
  record of dispatched issues is complete and no `R<n>` rule is broken by a second run starting
  mid-batch. Cross-machine runs are not guarded: one checkout owns the queue.
- **Every manifest write is one locked transaction.** A review registering a follow-up from inside
  a batch worktree writes the manifest in the primary checkout under a short lock, atomically, so
  it never waits on the dispatcher and never loses a concurrent edit.
- **Dispatch resumes.** A batch that grew a tail member re-fires, and members already APPROVED are
  skipped while their branch still chains as the next base (`--no-resume` re-runs them). The
  decision uses `.sandcastle/state`, so it is per-checkout.
- **Batches are atomic.** `--max-issues <n>` refuses a batch that would exceed the remaining budget
  rather than trimming it, because each member's branch is the next member's base.
- **`--json` owns stdout.** One object per command, one per decision for `queue run`; progress,
  drift warnings, and commit notices go to stderr.
- **Commit discipline.** With `queue.commit` (or `--queue-commit`) the manifest is committed in the
  primary checkout, only when that checkout is on `queue.commitBranch` (default `baseBranch`), and
  never pushed; any other branch is reported and skipped unless `--queue-commit-any` is passed.

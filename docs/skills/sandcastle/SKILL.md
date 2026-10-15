---
name: sandcastle
description: Fire, land, and shape Sandcastle work batches, and register the follow-ups a review files. Use for any sandcastle batch work or batch planning, and whenever a review files follow-up issues.
---

# Sandcastle

Sandcastle runs batches of `ready-for-agent` GitHub issues through three phases — design →
implement → review — each on its own worktree, then composes the batch into a single
**integration branch** and hands you a pull request to merge. GitHub stays canonical for issue
state. A **batch** is a named group of issues that run in order; its **name** is also its
integration: `sandcastle/integration/<name>`.

Two artifacts matter:

- **The queue manifest** — `sandcastle.queue.json` at the repo root, git-tracked. It records
  only what GitHub cannot say: batch composition and run order, gates, same-file rules. Every
  change goes through `pnpm sandcastle queue`, none through hand-editing.
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

**Every batch branches from the base ref.** No batch stacks on another batch's unlanded work, so
"when do I merge?" has one answer: when its PR is open and you have reviewed it. A batch that
reads an earlier batch's commits says so with `--after <batch>` and stays GATED until that
integration is an ancestor of the base — `queue list` prints that state, and `src/queue/gates.ts`
is the only thing that decides it.

Prose such as "runs only after X merges" is a bug: the scheduler cannot read it, so the batch
fires as soon as its members are labelled. Write `--after X` instead.

## Invocation

Two modes, one per question.

### Fire and land

1. **See what is takeable.** `pnpm sandcastle queue list` — a batch showing `READY` can fire.
2. **Fire it.** `pnpm sandcastle queue run`, or `--name <batch>` for one batch, or `--land` to
   compose each batch as it finishes. `run` re-reads the manifest and GitHub after every batch, so
   a follow-up registered mid-run changes what fires next in the same invocation. Done when the
   batch's members have run all three phases.
   Exit 1 means nothing could fire; exit 2 means a `--land` hand-off failed, so that batch needs a
   human before the queue moves on.
3. **Land it.** `pnpm sandcastle queue land --name <batch>`. Composing is automatic — conflict
   resolution and integration review are agents — and re-running `land` resumes an unfinished
   composition rather than restarting it. By default it **prints** the `git push` and
   `gh pr create` commands; `--create-pr` runs them for you. Either way, the PR body carries one
   `Closes #<n>` per member. A composition that no longer matches its batch — the tail moved, or a
   member branch moved after it was merged — is refused, and the refusal names the fix:
   `--recompose` drops that composition and rebuilds it from the batch's current tail.
4. **Merge it — this is the human step.** Review the PR and merge it. Every member issue closes
   with it, which is also what clears their `blocked-by` edges for later batches.
5. **Let the queue notice.** Once the merge is an ancestor of the base branch, batches with
   `--after <batch>` become READY on their own; the next `queue run` skips landed members and
   drops the batch. `queue land --name <batch> --finish` does the cleanup explicitly, and
   `--dry-run` reports it first.
6. **Reclaim the disk.** A worktree is disposable and its branch is the durable artifact, so
   `queue run --push-and-delete` pushes each member's branch and removes its worktree **as that
   member finishes** — the chain base is the branch, never the worktree, so nothing needs it
   afterwards. Use it on long batches: a 31-member batch otherwise holds 31 checkouts, each with
   whatever `setupCommands` installed. `queue clean --batch <name> --push-and-delete` does the same
   for a batch you already ran, and `queue clean --prune-git` clears the `.git/worktrees`
   registrations a hand-deleted worktree leaves behind. A member with uncommitted tracked paths
   keeps its worktree (a review can leave corrections that exist nowhere else); `--force` on
   `queue clean` is the explicit override.

### Shape the queue

1. **Read the current shape.** `pnpm sandcastle queue list` — READY/GATED plus drift.
2. **Place the work.** `queue bootstrap` proposes placements for the unplaced backlog
   (`--apply` writes them, `--dry-run` reports). By hand: `queue add --issue <n> --sequence
<batch>` to join a batch, `--gated --reason "<condition>"` for a wait, `--human --reason "..."`
   for a decision session a human must sit in.
3. **Shape the batch.** `pnpm sandcastle queue sequence --name <integration-work> --issues
<a,b,c>` sets membership in run order, with `--after <batch>` for a run-order gate, `--title`,
   `--roles <n=role,...>`, and `--notes`.
4. **Serialize same-file work.** `pnpm sandcastle queue rule --name R<n> --issues <a,b> --reason
"..."` for anything that must never be in flight together. Retire a stale rule with
   `queue rule --delete --name <R#>` (or match `--issues` exactly); `queue check` flags a rule
   whose members all sit in one batch, and retiring it is how the pre-flight returns to no-drift.
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
  GitHub's edges.
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

1. Find out who owns the seam before you file anything. Search the manifest for the files and
   modules the finding names — `queue list`, then the member bodies of every batch that mentions
   them. When another batch already has a member naming those files or that subsystem, the work
   belongs to **that** batch: register it there, or `--gated --reason "belongs to <batch>"` when
   that batch cannot take it. Appending it to the batch you are running is how two batches come to
   build the same thing twice — say which batch owns it, and quote the search you ran.
2. Fix it here when you can. A correction that is small, safe, and inside the reviewed work's blast
   radius belongs on the branch, not in a new issue; a review that files what it could have fixed
   leaves the branch less correct than it found it. A finding that needs a subsystem the reviewed
   issue never touched is not a follow-up to that issue: it is a new ticket, owned by the batch
   that owns that subsystem.
3. File each remaining follow-up as a GitHub issue (conventional title, milestone, labels,
   parent/blocker edges per `docs/agents/issue-tracker.md`). When the finding — or the fix — would
   change a contract another ticket owns (a closed decision, an acceptance criterion, a documented
   boundary), do not settle it inside the follow-up's body: file the contradiction, name the ticket
   it contradicts, and say whether that ticket is being amended (name the ADR) or the code is
   wrong. Search open issues for the same title shape first; if it already exists, register that
   number instead of filing a second one.
4. Register it in the same change — `queue add --issue <n> --sequence <batch>` (add `--after <this-issue>` only when this issue is the batch's **last** member, so the follow-up chains this branch next; inserting before a member that already ran leaves that member's branch behind the insertion, and `queue land` refuses a tail that moved), or `--gated
--reason` / `--human --reason`. Add an `R<n>` rule for a new same-file collision.
   Prefer continuing a running batch over parking the work: `--sequence <that batch>` appends the
   follow-up to its tail, and `queue run` re-fires the batch, skips the members that already passed
   review, and chains their branch as the new member's base, so the follow-up continues inside the
   same invocation. `--after <this-issue>` places it mid-batch instead of at the tail, which is what
   you want only when this issue is the batch's last member; otherwise the append goes to the
   tail. A tail growing faster than the head is work being discovered rather than sliced: when a
   finding is more than a review-sized change and touches a module the issue never named, prefer
   `--gated` over appending it. The new issue must already carry
   `ready-for-agent`: a member without it reads GATED, and the run stops and names the batch rather
   than starting unrelated work, so a follow-up filed without the label stalls the queue.
   A batch that is **already composed** cannot take a new member — `queue land`
   refuses a hand-off whose composition predates the tail rather than shipping a PR that closes an
   issue it does not carry — so that follow-up goes into another batch, or behind `--gated`.
5. Run `pnpm sandcastle queue check` and get **no drift**. With `queue.commit: true` the mutating
   commands commit the manifest themselves (never push); otherwise commit it, so the registration
   survives the worktree it was made in.

A deferred-by-design follow-up is APPROVED, not BLOCKED: the reviewed branch is right for its scope and safe to chain once the follow-up is filed, registered, and listed. Reserve BLOCKED for a branch that is itself wrong and must not chain — the batch stops at a BLOCKED member. `APPROVED` on a branch that contradicts a closed contract is correct only when the contradiction is filed as its own ticket naming that contract — never when it is buried in a follow-up's body.

A review that lists follow-ups in a comment but leaves the queue untouched is incomplete: the
queue is the runnable artifact, the comment is only the report.

## What `queue run` guarantees

- **One dispatcher per checkout**, held by a run lock, so no `R<n>` rule is broken by a second run
  starting mid-batch. Cross-machine runs are not guarded: one checkout owns the queue.
- **Every manifest write is one locked transaction**, so a review registering a follow-up from
  inside a batch worktree writes the manifest in the primary checkout without waiting on the
  dispatcher and without losing a concurrent edit.
- **Dispatch resumes**, and batches are atomic: members already APPROVED are skipped while their
  branch still chains as the next base (`--no-resume` re-runs them), and `--max-issues <n>` refuses
  a batch that would exceed the budget rather than trimming it.

## Bypass

A repo that does not want the queue workflow sets `queue.enabled: false` in `sandcastle.config.ts`,
or passes `--no-queue` for one invocation (`--queue` re-enables it, `--queue-commit` opts into
committing the manifest). Reviews then report follow-ups in the issue comment only and no queue
gate applies.

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

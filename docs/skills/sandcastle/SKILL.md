---
name: sandcastle
description: Run, merge, and plan work batches with the Sandcastle three-phase agent runner — fire an issue-sequence batch, merge landed batches, register review follow-ups in the queue manifest, and check queue drift before firing. Use for any sandcastle batch work or batch planning, and whenever a review files follow-up issues.
---

# Sandcastle

Batches of `ready-for-agent` GitHub issues run through the three-phase Sandcastle runner
(design → implement → review) on persistent per-issue worktrees, then merge into one
integration branch per batch. GitHub issues are the canonical store for issue state;
the **queue manifest** (`sandcastle.queue.json`, repo root, git-tracked) records only what
GitHub cannot express — batch composition and run order, same-file serialization rules
(R\<n\>), and gate conditions.

This file is the tracked source of truth. `.agents/skills/sandcastle/SKILL.md` is a
gitignored pointer to it (`pnpm sandcastle` reads the commands below, not this file).

## Commands

Run a batch (one branch; `--resume --ignore-setup` on re-runs):

```bash
pnpm sandcastle issue-sequence --sequential <id,id,...> --base main --resume --ignore-setup
```

Merge a landed batch (one PR; `--issues` lists the **tail issue of each sequence** in the
branch):

```bash
pnpm sandcastle merge --name <branch-name> --issues <tail,tail,...>
```

Every command answers `--help` with its own usage, options, and exit codes:

```bash
pnpm sandcastle queue run --help     # one topic per command and queue subcommand
```

## Queue (the runnable artifact)

```bash
pnpm sandcastle queue list                                   # live READY/GATED view + drift (read-only)
pnpm sandcastle queue check [--strict-gates]                  # exits 1 on drift, 2 with stale gates
pnpm sandcastle queue graph [--expand-issues]                  # Mermaid run order, gates, rules
pnpm sandcastle queue graph --format json                      # the same payload, for tooling
pnpm sandcastle queue graph --write docs/queue.md              # Markdown page (no timestamp)
pnpm sandcastle queue graph --comment <n>                      # sticky graph on a tracker issue
pnpm sandcastle queue run [--name <batch>] [--max-issues <n>]  # fire the next READY batch
pnpm sandcastle queue run --require-clean                     # refuse while drift exists
pnpm sandcastle queue run --promote-gates                     # promote ready gates first
pnpm sandcastle queue run --no-resume                         # re-run landed members
pnpm sandcastle queue run --dry-run                           # print the decision, dispatch nothing
pnpm sandcastle queue bootstrap [--apply]                     # propose placements for the backlog
pnpm sandcastle queue add --issue <n> --sequence <batch> [--after <m>]
pnpm sandcastle queue add --issue <n> --gated --reason "..."  # cannot start yet
pnpm sandcastle queue add --issue <n> --human --reason "..."  # human decision session (grill)
pnpm sandcastle queue sequence --name <batch> --issues <a,b,c> [--merge-name <branch>] [--notes "..."]
pnpm sandcastle queue rule --name R<n> --issues <a,b> --reason "..."   # same-file serialization
pnpm sandcastle queue remove --issue <n>                      # deliberate move between batches
pnpm sandcastle queue promote --issue <n> [--sequence <batch>] # un-gate into a batch
pnpm sandcastle queue promote --apply                         # promote every promotable gate
pnpm sandcastle queue sequence --name <batch> --delete         # drop a sequence definition
pnpm sandcastle queue prune --closed                          # drop references to CLOSED issues
```

`queue list` / `queue check` fetch issue state live (open/closed, `ready-for-agent`,
blocked-by edges) and flag drift: unplaced ready-for-agent issues, closed-but-referenced
issues, referenced-but-missing issues. `queue check` must report no drift before anything
fires.

`queue graph` is the view to hand a human: one node per batch in run order, edges for the
`after <integration>` gates, the `serialized` rules, and live cross-batch blocked-by links, with
`--expand-issues` drawing each batch as a subgraph of its members. Mermaid renders in GitHub
files, issues, PRs, and comments, so the diagram can sit beside the plan it describes. `--write`
emits the Markdown page without a render timestamp, so a committed copy can be diffed for schedule
drift; `--comment <n>` posts that page and updates its own comment on re-run. It is read-only.

`queue run` re-reads the manifest after every batch, so a review that registers a follow-up,
promotes a gate, or files a new `ready-for-agent` issue changes what runs next inside the same
invocation. It prunes landed entries (issue closed + review APPROVED) unless `--keep-entries`,
exits 1 when nothing can fire (unknown `--name`, or an exhausted queue), and prints the tail
issue to pass to `sandcastle merge`. `--max-issues <n>` caps one invocation; `--json` prints
one JSON object per decision.

A closed issue in a batch gates that batch forever — `queue prune --closed` is the CLI exit
for that state (`--dry-run` reports first; `human` entries are never pruned).

## Rules

- **Sequence order is a dependency statement**: each completed issue's branch becomes the
  next base; later members contain earlier members' commits.
- **Append rule**: an issue whose only open blockers are earlier `ready-for-agent` members
  of its sequence belongs _in_ that sequence — position satisfies the edge (the harness
  never consults GitHub edges). Append along dependency and same-file-serialization lines;
  never to shrink the queue.
- **Merge rule**: `--issues` lists only the tail of each sequence in the branch.
- **Same-file rule**: two runs touching the same files never run in parallel — one
  sequence (position serializes them) or a numbered rule (R\<n\>) plus serialized runs.
  `queue run` skips a batch that shares a rule with anything it already dispatched.
- **Never queue a `wayfinder:grilling` issue** — a grilling is a human decision session
  (use `--human`); use `--gated --reason` for issues waiting on a condition.

## Gates before firing a batch

1. `pnpm sandcastle queue check` reports **no drift**, and the batch shows `READY`
   (every member open + `ready-for-agent`, no open blocker outside the sequence).
2. No pair in the batch violates a numbered rule (R\<n\>).
3. Cross-batch order rules ("only after X merges") are respected — they live in rule
   reasons and sequence notes.

## Review follow-ups (the contract that keeps the queue honest)

Most common failure mode: a review finds extra issues, files them on GitHub, and stops —
the queue never learns about them, so the next planning pass misses them. When you run any
review (sandcastle phase or a manual `/code-review` session):

1. File each follow-up as a GitHub issue (conventional title, milestone, labels,
   parent/blocker edges per `docs/agents/issue-tracker.md`).
2. Register it in the queue in the same change:
   `pnpm sandcastle queue add --issue <n> --sequence <batch>` (or `--gated --reason` /
   `--human --reason`). Add a numbered rule (R\<n\>) for new same-file collisions.
3. Run `pnpm sandcastle queue check` — it must report no drift. With `queue.commit: true`
   the mutating commands commit the manifest themselves (never push); otherwise commit it
   yourself so the registration reaches the repository instead of dying with the worktree.

A review that lists follow-ups in the issue comment but leaves the queue untouched is
incomplete. The queue is the runnable artifact; the comment is only the report.

## Bypass

Repositories that do not want the queue workflow set `queue.enabled: false` in
`sandcastle.config.ts`, or pass `--no-queue` for one invocation (`--queue` re-enables it, and
`--queue-commit` opts into committing the manifest). Reviews then report follow-ups in the
issue comment only, and no queue gate applies — the review prompts switch contracts through
`prompts/queue.ts` (`{{QUEUE_RULES}}`), so never hard-code queue instructions in a prompt
override without that placeholder.

## Dispatch safety (what a `queue run` guarantees)

- **One dispatcher per checkout.** `queue run` holds a run lock, so two runs cannot overlap; its
  in-memory record of dispatched issues is therefore complete, and a numbered rule (R\<n\>) cannot
  be broken by a second run starting mid-batch. Cross-machine runs are not guarded — one checkout
  owns the queue.
- **Every manifest write is one locked transaction.** A review registering a follow-up inside a batch
  (`.sandcastle/worktrees/<branch>`) writes the manifest in the primary checkout under a short lock,
  so it never waits on the dispatcher and never loses a change made in another terminal. The file is
  replaced atomically, so `queue list` cannot read a half-written manifest.
- **Dispatch resumes.** A sequence that grew a tail member re-fires, and members already complete
  with an APPROVED review are skipped while their branch still chains as the next base (`--no-resume`
  to re-run them). The skipped/landed decision uses `.sandcastle/state`, so it is per-checkout.
- **Batches are atomic.** `--max-issues <n>` refuses a batch that would exceed the remaining budget
  rather than trimming it, because each member's branch is the next member's base.
- **`--json` owns stdout.** Single-shot subcommands print one object; `queue run` prints one object
  per decision. Progress, drift warnings, and commit notices go to stderr.
- **Commit discipline.** With `queue.commit` (or `--queue-commit`) the manifest is committed in the
  primary checkout only when that checkout is on `queue.commitBranch` (default `baseBranch`), and
  never pushed; any other branch is reported and skipped unless `--queue-commit-any` is passed.

# @lisachandra/sandcastle

Runs labelled GitHub issues through three agent phases — **design → implement → review** — each on a
persistent worktree, then composes a batch of reviewed branches into one integration branch and hands you
a pull request. It never merges: the review and the merge stay yours.

GitHub remains the source of truth for issue state. A small git-tracked manifest records only what GitHub
cannot express — batch order, gates between batches, and "never run these two together" rules.

## The shape of a run

An issue gets three separate agent conversations:

1. **Design** researches the issue and writes a TDD plan to `.sandcastle/plans/<n>.md`.
2. **Implement** works from that plan on a persistent branch and worktree.
3. **Review** reads the diff cold, fixes what it finds, and posts
   `Sandcastle-Review: APPROVED` or `BLOCKED` on the issue.

Separate conversations are deliberate: the implementer reads the plan as a file rather than inheriting
the reasoning, and the reviewer sees the diff rather than the intent. Each phase ends by writing a
`.completed` marker; a clean exit without one counts as a failure, so a truncated run is not mistaken for
success.

`sandcastle --issue 123` runs one issue. `sandcastle --issue all` plans and dispatches the unblocked
backlog.

## Configuring

Create `sandcastle.config.ts` at the repository root. Only the fields a repo actually needs are usually
set — agent backend and model, setup commands, and the label that marks AFK-ready work:

```ts
import type { SandcastleUserConfig } from "@lisachandra/sandcastle";

const config: SandcastleUserConfig = {
	setupCommands: ["pnpm setup"],
	labels: { readyForAgent: "ready-for-agent" },
	agents: {
		models: { dirac: "dirac-model" },
		steps: { review: { backend: "codex", effort: "high" } },
	},
};

export default config;
```

`agents.steps` is where a workflow gets cheaper or stronger per phase — a small model for design and a
strong one for review is the usual shape. A CLI flag always wins over it, and it wins over the workflow
default, so `--implement-model` can rescue a single run without editing the file.

Credentials stay in the environment, never in the config: `OPENAI_API_KEY`, `OPENAI_API_BASE`, and
`GH_TOKEN` are the ones still read from it. Put them in a repo-root `.env`, which setup copies into every
worktree so the agents inherit it. Legacy `SANDCASTLE_AGENT`, `SANDCASTLE_EFFORT`, `SANDCASTLE_MODEL`, and
`DIRAC_SANDCASTLE_MODEL` / `PI_SANDCASTLE_MODEL` are no longer read — setting them prints a warning
pointing at the config key that replaced them (`SANDCASTLE_MODEL` is simply ignored).

Setup commands run in each fresh worktree before the agents start. Output is logged to a per-worktree
file rather than streamed, because an install that prints thousands of lines buries the agent's output;
a failure prints the last 30 lines to the terminal, and stdin is closed so a command waiting for input
fails instead of hanging an unattended run. Set `setupOutput: "inherit"` (or `--setup-output inherit`)
when you want the old streaming behaviour.

## The queue

Reviews find follow-up work, it gets filed, and it never reaches the plan. The queue closes that gap: a
manifest of batches that `queue run` dispatches from, so filed follow-ups actually get scheduled.

```bash
pnpm sandcastle queue list              # READY/GATED batches plus drift
pnpm sandcastle queue run               # fire everything that is ready
pnpm sandcastle queue run --land        # ...and compose each batch as it finishes
pnpm sandcastle queue land --name <batch> --create-pr
```

`land` composes the batch on `sandcastle/integration/<name>`, resolving conflicts and running an
integration review with agents, then opens a PR whose body closes every member. Merging that PR is the
human step, and it is also what unblocks any batch waiting on this one.

A **batch** is a named, ordered group, and its name _is_ its integration branch, so names are unique.
Order inside a batch is a dependency: each member's branch is the next one's base. That is why
parallelism is between batches only — members of one batch must stay serial.

Placement is done through the CLI, never by editing the JSON:

```bash
pnpm sandcastle queue add --issue 42 --sequence <batch> --after 41
pnpm sandcastle queue sequence --name <batch> --issues 40,41,42
pnpm sandcastle queue rule --name R1 --issues 41,42 --reason "same file"
```

`queue add --gated` parks an issue until a stated condition clears; `--human` marks a decision that needs
a person and is never auto-promoted. A `queue check` that reports drift means the manifest and GitHub
disagree — an unplaced `ready-for-agent` issue, a closed issue still in a batch — and it must be clean
before firing.

### Gates between batches

A batch that needs another batch's commits is declared with `--after <batch>` and stays GATED until that
integration is an ancestor of the base branch. It clears itself once the PR merges, so no manual step is
needed. Prose like "runs after X merges" is invisible to the scheduler — that is the bug `--after`
exists to replace.

## Landing

`land` composes the batch, then prints the `git push` and `gh pr create` commands unless you pass
`--create-pr`. A composition that no longer matches its batch — the tail moved, a member branch moved
after it was merged — is refused rather than shipped, because its PR would close issues it does not
carry; `--recompose` rebuilds it from the current tail.

## Reclaiming worktrees

Branches are durable and worktrees are disposable. A long batch otherwise accumulates one full checkout
per member, each with its own installed dependencies.

```bash
pnpm sandcastle queue run --push-and-delete
pnpm sandcastle queue clean --batch <batch> --push-and-delete
pnpm sandcastle queue clean --prune-git
```

`--push-and-delete` pushes a member's branch and removes its worktree as that member finishes, since the
next member is cut from the branch and never needs the checkout. Two things keep it safe: a member with
uncommitted tracked paths keeps its worktree (a review can leave corrections that exist nowhere else),
and so does a member whose push failed. `--prune-git` only clears the `.git/worktrees` registrations a
hand-deleted checkout leaves behind.

## Changing a run in flight

Edit `sandcastle.config.ts`. A running run re-reads it every 30 seconds, and a step whose model changed is
restarted on the new value without counting as a failure — so an overnight run can be moved to a
different model without killing it. A config that does not parse is reported once and ignored, and the
last good config keeps running. Two changes require a new run: `dir` and any step's `backend`, because a
stored session can only be resumed by the same backend.

## Parallel batches

`queue run --parallel 2` runs two batches at once, one lane each. This is safe precisely because batches
never stack: every batch starts from the base ref, gates carry the real dependencies, and `R<n>` rules
keep colliding issues apart.

```ts
agents: {
	catalog: [
		{ name: "flash", backend: "zcode", model: "glm-5.3-flash", effort: "high" },
		{ name: "deep", backend: "zcode", model: "glm-5.3", effort: "max" },
	],
},
queue: { parallel: 2 },
```

Lane `k` uses `catalog[k % n]` for the whole invocation, so an assignment is reproducible. Each lane is a
child process with its own log, so one blocked batch cannot take its siblings down; landing stays in the
parent and runs serially. A pool summary at the end reports per-batch duration and how much of the run had
every lane busy, which answers "was this actually parallel?" without guessing.

## One dispatcher at a time

Two runs on one checkout would break the same-file rules, so a run holds a lock; across machines it also
holds a lease ref on `origin`, acquired by compare-and-swap. The lease expires after 30 minutes without
renewal, so a crashed machine cannot wedge the queue, and a holder on this host whose process is gone is
taken over immediately.

`Ctrl+C` once cancels cleanly: the in-flight agent is aborted, no further batch starts, locks and lease
are released, and the run exits `130` with nothing landed — re-running resumes. If the terminal is already
gone, `pnpm sandcastle queue cancel` clears the residue without ever signalling a process.

## Backends

`zcode` and `dirac` are the two with full support, including **session resume**: a failed phase continues
its previous conversation instead of starting over, and `--single-session` chains design → implement →
review through one conversation so each phase sees the previous reasoning. Resume is why
`--single-session` is limited to those two backends.

`codex`, `claude-code`, `cursor`, `opencode`, `copilot`, and `pi` run each phase fresh.

`sandcastle --help` and `sandcastle queue <subcommand> --help` cover the flags and exit codes. The
operational contract for the queue — including how a review must register its follow-ups — lives in
[`docs/skills/sandcastle/SKILL.md`](../../docs/skills/sandcastle/SKILL.md).

# @lisachandra/sandcastle

Sandcastle is a three-phase agent runner for GitHub issues:

1. **Design** — a planning agent researches the issue and writes a TDD plan.
2. **Implement** — an agent implements the plan on a persistent issue branch/worktree.
3. **Review** — an agent reviews the diff, fixes findings, and leaves a machine-readable
   `Sandcastle-Review: APPROVED|BLOCKED` comment on the issue.

It also composes reviewed issue branches into integration branches for a human merge.

## Requirements

- Node.js ≥ 20.12 and pnpm ≥ 11 (for the `gh:` registry alias used with private GitHub Packages)
- The `gh` CLI authenticated for the target repository
- An agent backend (`dirac` or `pi`) with its model configured via `.sandcastle/.env`

## Install

```bash
pnpm add -D @lisachandra/sandcastle
```

## Configuration

Create `sandcastle.config.ts` at the repository root. Every field is optional; generic
defaults are used otherwise. The file is loaded with jiti and validated with zod.

```ts
import type { SandcastleUserConfig } from "@lisachandra/sandcastle";

const config: SandcastleUserConfig = {
	dir: ".sandcastle",
	baseBranch: "main",
	setupCommands: ["scripts/bash/fetch-places.sh && pnpm setup"],
	symlinks: [
		{ path: "creator-docs", target: "creator-docs" },
		{ path: ".diracrules", target: ".agents" },
	],
	prompts: {
		plan: ".sandcastle/plan-prompt.md",
	},
	skills: {
		labels: {
			ecs: { design: ["ecs-design"], implement: ["ecs-design"] },
		},
	},
	labels: { readyForAgent: "ready-for-agent" },
	reviewMarker: "Sandcastle-Review",
	issueCommand: "gh issue view {issue}",
	agents: {
		enabled: ["claude-code", "codex", "copilot", "cursor", "dirac", "opencode", "pi"],
		default: "dirac",
		models: { dirac: "dirac-model", codex: "codex-model" },
		steps: {
			design: { model: "cheap-planner", effort: "medium" },
			implement: { model: "strong-coder", effort: "max" },
			review: { backend: "codex", effort: "high" },
		},
	},
	effort: "xhigh",
};

export default config;
```

`SandcastleUserConfig` accepts the same partial shapes as the validator (every field
optional). Programmatic consumers that need the fully-resolved config (all prompt paths
absolute, defaults merged) can use `SandcastleConfig` / `loadConfig`.

### Options

| Option                 | Default                 | Purpose                                                                                                                                                       |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir`                  | `.sandcastle`           | State, plans, logs, worktrees, and integrations directory                                                                                                     |
| `baseBranch`           | `main`                  | Diff base for implementation and review                                                                                                                       |
| `setupCommands`        | `[]`                    | Shell commands run in a fresh worktree before phase agents                                                                                                    |
| `symlinks`             | `[]`                    | Repository directories linked into fresh worktrees                                                                                                            |
| `prompts`              | package defaults        | Per-phase prompt file paths (repo-relative)                                                                                                                   |
| `queue.file`           | `sandcastle.queue.json` | Queue manifest path (repo-relative) used by the `sandcastle queue` command group                                                                              |
| `queue.enabled`        | `true`                  | Set `false` to bypass the queue workflow entirely (no gates, reviews report follow-ups in the comment only); `--no-queue` / `--queue` override per invocation |
| `queue.commit`         | `false`                 | Commit the manifest after each mutating queue command (never pushes)                                                                                          |
| `skills.defaults`      | phase defaults          | Skills injected into each phase prompt                                                                                                                        |
| `skills.labels`        | `{}`                    | Extra skills per issue label (e.g. `ecs`, `security`, `ui`)                                                                                                   |
| `labels.readyForAgent` | `ready-for-agent`       | Issue label that marks AFK-ready issues                                                                                                                       |
| `reviewMarker`         | `Sandcastle-Review`     | Comment marker prefix (`<marker>: APPROVED                                                                                                                    | BLOCKED`) |
| `issueCommand`         | `gh issue view {issue}` | Command template used to fetch issue data                                                                                                                     |
| `agents.enabled`       | all supported backends  | Allowed agent backends (`claude-code`, `codex`, `copilot`, `cursor`, `dirac`, `opencode`, `pi`)                                                               |
| `agents.default`       | `dirac`                 | Backend used when `--agent` is not passed                                                                                                                     |
| `agents.models`        | `{}`                    | Default model per backend, used when `--model` is not passed                                                                                                  |
| `agents.steps`         | `{}`                    | Per-step `{ backend, model, effort }` overrides for `design`, `implement`, `review`, `planner`, `resolve`, `integrationReview`                                |
| `effort`               | `xhigh`                 | Default reasoning effort                                                                                                                                      |

Precedence for every step is CLI flag (`--design-model`, `--implement-agent`, `--review-effort`, `--planner-*`, `--resolve-*`, `--integration-review-*`) over `agents.steps` config over the workflow default (`--agent` / `--model` / `--effort` plus `agents.models`). When a step selects a different backend without its own model, the mapped `agents.models[backend]` wins over the workflow model.

### Local docs via `creator-docs`

Repos that need Roblox API documentation for agents keep a local, gitignored copy of the
[`roblox/creator-docs`](https://github.com/roblox/creator-docs) repository:

1. Sparse-checkout the docs once into a shared location (outside the repo):

    ```bash
    git clone --filter=blob:none --sparse https://github.com/roblox/creator-docs F:/Acid/creator-docs
    git -C F:/Acid/creator-docs sparse-checkout set content
    ```

2. Junction (Windows) or symlink it into the repository root as `creator-docs`:

    ```powershell
    New-Item -ItemType Junction -Path <repo>/creator-docs -Target F:/Acid/creator-docs
    ```

3. Ignore it: add `creator-docs/` to the repo's `.gitignore` (or `.git/info/exclude` for a
   machine-local setup).

4. Reference it in `sandcastle.config.ts` so agents in fresh worktrees can read the docs:

    ```ts
    symlinks: [{ path: "creator-docs", target: "creator-docs" }],
    ```

The docs are never committed; each worktree gets a junction to the same sparse checkout, and
the link is skipped with a warning if the target is missing.

## Usage

```bash
sandcastle --issue 123 --dry-run   # print resolved config without running
sandcastle --issue 123             # run design, implement, review
sandcastle --issue 123 --resume    # resume the incomplete phase
sandcastle --issue 123 --skip-setup # reuse worktree without re-running setup commands
sandcastle --issue all             # plan + dispatch unblocked issues
sandcastle issue-sequence --sequential 156,157,158 --base main
sandcastle merge --name release-candidate --issues 150,151 --base main
```

By default every run executes `setupCommands` and links configured `symlinks` in the worktree
before agents start — including integration merges (`merge`, `merge-integrations`, and
`integration-resume`). `--ignore-setup` continues even if the setup command fails (symlinks are
still linked); `--skip-setup` skips the setup commands entirely while still linking symlinks.

Because integration worktrees are long-lived, they accumulate uncommitted changes: setup
artifacts (fetched places, submodule checkouts), formatter churn from `lint:fix`, and agent
edits that no source branch owns. When a source also touched one of those files, git aborts the
merge with "Your local changes to the following files would be overwritten by merge" — and the
conflict resolver cannot act on that.

The merge loop therefore inspects the worktree first:

- default: fail before merging, list the blocking paths, and record status `blocked`
- `--quarantine-drift`: `git stash push -m "sandcastle <name>: pre-merge drift"` those paths,
  record the stash commit on the manifest, and continue merging
- submodule pointers are reported but never block a merge (git merges over them)
- untracked files are ignored, so the `.agents` / `.diracrules` / `creator-docs` junctions are
  never stashed

`integration-status` prints the quarantined paths and the `git stash apply <commit>` command to
restore them. Only genuine unmerged paths produce `conflict-resolution-required`; blocked runs
are resumable and re-enter the same source once the worktree is clean.

### Standalone worktree setup (`sandcastle setup`)

Harnesses (like paseo) and manual `git worktree add` flows can prepare a worktree without
starting an agent. The command reads the same `sandcastle.config.ts` fields and is
idempotent:

```bash
sandcastle setup                        # prepare the current directory
sandcastle setup --worktree <path>      # prepare an existing worktree path
sandcastle setup --branch <name> [--base <ref>]  # create/reuse a worktree and prepare it
sandcastle setup --dry-run              # print what would happen, execute nothing
```

Preparation is identical to what an issue run performs before its phases: create the
`.sandcastle/{worktrees,logs,plans,state,integrations}` directories, copy the repo `.env`
when present, run `setupCommands`, and link `symlinks`. `--ignore-setup` and `--skip-setup`
behave as in the issue workflow. A bare `sandcastle setup` (no flags) targets the current
directory — the shape paseo hands you for a clean worktree.

Persistent issue worktrees live in `.sandcastle/worktrees/sandcastle-issue-<n>`, state in
`.sandcastle/state/<n>.json`, plans in `.sandcastle/plans/<n>.md`, completion markers in
`.sandcastle/markers/`, and logs in `.sandcastle/logs/issue-<n>.log` (live upstream log output;
`issue-<n>.dirac.log` additionally streams a clean markdown digest for dirac runs). Each phase agent
finishes by creating a scoped `.completed` marker as its final action; the runner treats a
clean exit without that marker as a phase failure. The runner never closes issues, merges
branches, or publishes releases; the final human merge is yours.

## Queue (`sandcastle queue`)

Reviews regularly surface follow-up work: new issues that get filed on GitHub but never make
it into the batch plan. The queue command group closes that gap. GitHub issues stay the
canonical store for issue state (open/closed, labels, blocked-by edges — always fetched
live); the queue manifest (default `sandcastle.queue.json`, at the repository root,
git-tracked) records only what GitHub cannot express — batch composition and run order,
same-file serialization rules, and gate conditions:

```bash
sandcastle queue add --issue 42 --sequence U2                    # append to a batch
sandcastle queue add --issue 42 --sequence U2 --after 41         # insert after issue 41
sandcastle queue add --issue 43 --gated --joins V --reason "waiting on issue 41"
sandcastle queue add --issue 44 --human --reason "needs a human decision session"
sandcastle queue sequence --name U2 --title "ui wiring" --issues 40,41,42 \n  --roles 40=shell,41=pause --merge-name ui-wiring-work --after-merge audio-seam-work
sandcastle queue sequence --name U2 --issues 40,41,42 --before V    # place a batch in the run order
sandcastle queue sequence --name X1 --delete                        # drop a batch (no --issues needed)
sandcastle queue rule --name R2 --issues 41,42 --reason "same file"
sandcastle queue remove --issue 43
sandcastle queue list       # live view: READY/GATED batches, promotable gates, drift
sandcastle queue check      # same view; exits non-zero while drift exists
sandcastle queue run --name U2  # fire the next READY batch; re-reads the manifest after each one
sandcastle queue bootstrap       # propose placements for the unplaced backlog (--apply writes them)
```

`queue list` / `queue check` fetch live issue state (`gh issue list` plus one batched
GraphQL call for blocked-by edges) and render the visualization: per-batch READY/GATED with
reasons, gated issues that are now promotable, and drift — unplaced ready-for-agent issues,
closed-but-referenced issues, and referenced-but-missing issues. Each batch also renders what
the manifest knows and GitHub does not: `title` beside the batch name, a `roles` phrase
beside every member, and each `notes` line under the membership. `queue check` is safe to
run after any review that files follow-up issues: it must report no drift before a review
completes. The bundled review prompts reference these commands; repos that override
`prompts.review` / `prompts.reviewIntegration` should keep that contract.

`queue run` dispatches the next READY sequence, re-reads the manifest after every batch, and prunes
landed entries (`--keep-entries` to keep them), so a review that registers a follow-up changes what
runs next inside the same invocation; `--max-issues <n>` caps one invocation. `queue bootstrap`
proposes placements for the unplaced backlog grouped by title scope. Repositories that do not want
the workflow set `queue.enabled: false` (or pass `--no-queue`): the gate disappears and reviews only
report follow-ups in their comment. With `queue.commit: true` the mutating commands commit the
manifest themselves; otherwise commit it yourself, or the registration dies with the worktree.

`sequences[].afterMerge` is a run-order gate: the batch stays GATED until that integration has
been composed **and** its head commit is an ancestor of the base branch — the check a batch that
consumes an earlier batch's commits actually needs. It is evaluated in `queue/gates.ts` with
`git merge-base --is-ancestor`, it fails closed (a missing manifest, an unfinished composition,
or a missing head commit all read as "not landed"), and it replaces the prose "runs only after
X merged" that the scheduler used to ignore. A gated entry's `joins` records the batch it will
move into, and `queue promote` prefers it over the issue title's conventional scope.

The `sequences` array **is** the run order. A redefinition keeps its position, a new batch joins the
tail, and `--before <batch>` moves one explicitly, so editing a batch never re-ranks the schedule.

## Backends

Sandcastle supports `dirac` (default), `pi`, `codex`, `claude-code`, `cursor`, `opencode`,
and `copilot`. Dirac is the custom default; the native backends come from
`@ai-hero/sandcastle` and are wrapped by the same marker-based completion layer. The marker
file is the only completion contract — no completion token is used. The agent backend,
default model, and effort are configured in `sandcastle.config.ts`; only credentials belong
in the environment:

```ini
# Credentials only (loaded from .sandcastle/.env or the process environment)
OPENAI_API_KEY=
OPENAI_API_BASE=
GH_TOKEN=
```

Legacy `SANDCASTLE_AGENT`, `SANDCASTLE_EFFORT`, `DIRAC_SANDCASTLE_MODEL`, and
`PI_SANDCASTLE_MODEL` environment variables still work as fallbacks but print deprecation
warnings; move them into `sandcastle.config.ts` (`agents.default`, `agents.models`, `effort`).

## Development

```bash
pnpm build          # compile TypeScript to dist/
pnpm test           # typecheck (tsconfig.test.json) + node:test suite via tsx
```

The runner is split into focused modules under `src/`, with `main.ts` as the thin CLI entry
that re-exports the public API:

- `runtime.ts` — repository/config context and the injectable `io` boundary
- `cli.ts` — argument parsing and help (including `--<step>-model|agent|effort` flags)
- `steps.ts` — per-step resolution (CLI flag over `agents.steps` over workflow default)
- `issue.ts` / `sequential.ts` — single-issue and sequential workflows
- `integrations.ts` — integration composition and merge-conflict resolution
- `queue/` — queue manifest, live GitHub state, and the `sandcastle queue` command group
- `evaluate.ts` / `state.ts` — phase decisions and persisted issue state (`phasesConfig`)
- `agent.ts` / `worktree.ts` / `git.ts` / `retry.ts` — agent providers, worktrees, git, retries

Each module has a matching `*.test.ts` file; shared test fixtures live in
`src/test-helpers.ts`.

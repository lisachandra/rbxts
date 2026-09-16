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

| Option                 | Default                 | Purpose                                                                                         |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `dir`                  | `.sandcastle`           | State, plans, logs, worktrees, and integrations directory                                       |
| `baseBranch`           | `main`                  | Diff base for implementation and review                                                         |
| `setupCommands`        | `[]`                    | Shell commands run in a fresh worktree before phase agents                                      |
| `symlinks`             | `[]`                    | Repository directories linked into fresh worktrees                                              |
| `prompts`              | package defaults        | Per-phase prompt file paths (repo-relative)                                                     |
| `skills.defaults`      | phase defaults          | Skills injected into each phase prompt                                                          |
| `skills.labels`        | `{}`                    | Extra skills per issue label (e.g. `ecs`, `security`, `ui`)                                     |
| `labels.readyForAgent` | `ready-for-agent`       | Issue label that marks AFK-ready issues                                                         |
| `reviewMarker`         | `Sandcastle-Review`     | Comment marker prefix (`<marker>: APPROVED                                                      | BLOCKED`) |
| `issueCommand`         | `gh issue view {issue}` | Command template used to fetch issue data                                                       |
| `agents.enabled`       | all supported backends  | Allowed agent backends (`claude-code`, `codex`, `copilot`, `cursor`, `dirac`, `opencode`, `pi`) |
| `agents.default`       | `dirac`                 | Backend used when `--agent` is not passed                                                       |
| `agents.models`        | `{}`                    | Default model per backend, used when `--model` is not passed                                    |
| `agents.steps`         | `{}`                    | Per-step `{ backend, model, effort }` overrides for `design`, `implement`, `review`, `planner`, `resolve`, `integrationReview` |
| `effort`               | `xhigh`                 | Default reasoning effort                                                                        |

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
- `evaluate.ts` / `state.ts` — phase decisions and persisted issue state (`phasesConfig`)
- `agent.ts` / `worktree.ts` / `git.ts` / `retry.ts` — agent providers, worktrees, git, retries

Each module has a matching `*.test.ts` file; shared test fixtures live in
`src/test-helpers.ts`.

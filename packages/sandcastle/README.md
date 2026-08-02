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
import type { SandcastleConfig } from "@lisachandra/sandcastle";

const config: SandcastleConfig = {
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
	agents: { enabled: ["dirac", "pi"] },
	effort: "xhigh",
};

export default config;
```

### Options

| Option | Default | Purpose |
| --- | --- | --- |
| `dir` | `.sandcastle` | State, plans, logs, worktrees, and integrations directory |
| `baseBranch` | `main` | Diff base for implementation and review |
| `setupCommands` | `[]` | Shell commands run in a fresh worktree before phase agents |
| `symlinks` | `[]` | Repository directories linked into fresh worktrees |
| `prompts` | package defaults | Per-phase prompt file paths (repo-relative) |
| `skills.defaults` | phase defaults | Skills injected into each phase prompt |
| `skills.labels` | `{}` | Extra skills per issue label (e.g. `ecs`, `security`, `ui`) |
| `labels.readyForAgent` | `ready-for-agent` | Issue label that marks AFK-ready issues |
| `reviewMarker` | `Sandcastle-Review` | Comment marker prefix (`<marker>: APPROVED|BLOCKED`) |
| `issueCommand` | `gh issue view {issue}` | Command template used to fetch issue data |
| `agents.enabled` | `["dirac", "pi"]` | Allowed agent backends |
| `agents.default` | `dirac` | Backend used when `--agent` is not passed |
| `agents.models` | `{}` | Default model per backend, used when `--model` is not passed |
| `effort` | `xhigh` | Default reasoning effort |

## Usage

```bash
sandcastle --issue 123 --dry-run   # print resolved config without running
sandcastle --issue 123             # run design, implement, review
sandcastle --issue 123 --resume    # resume the incomplete phase
sandcastle --issue all             # plan + dispatch unblocked issues
sandcastle issue-sequence --sequential 156,157,158 --base main
sandcastle merge --name release-candidate --issues 150,151 --base main
```

Persistent issue worktrees live in `.sandcastle/worktrees/sandcastle-issue-<n>`, state in
`.sandcastle/state/<n>.json`, plans in `.sandcastle/plans/<n>.md`, and logs in
`.sandcastle/logs/issue-<n>.log`. The runner never closes issues, merges branches, or
publishes releases; the final human merge is yours.

## Backends

Sandcastle supports `dirac` (default) and `pi` via `@ai-hero/sandcastle`, plus a
`no-sandbox()` host runner. The agent backend, default model, and effort are configured in
`sandcastle.config.ts`; only credentials belong in the environment:

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
pnpm test           # node:test suite via tsx
```

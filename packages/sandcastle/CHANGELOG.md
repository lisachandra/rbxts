# @lisachandra/sandcastle

## 1.0.0

### Major Changes

- [`1e03696`](https://github.com/lisachandra/rbxts/commit/1e03696ad5a585ed11b19f199ec125e6d899e68b) Thanks [@lisachandra](https://github.com/lisachandra)! - Give the queue a landing step, and one name per batch. A batch's `name` is now its integration name
  (`sandcastle/integration/<name>`) — the v1 split between a short code and a separate `mergeName` was
  two namespaces for one thing — and `afterMerge` is now `after`, so the manifest schema is version 2
  and `readQueueManifest` refuses a v1 file by name. `sandcastle queue migrate` translates one: it
  prints every rename, fold, and remapped `after`/`joins` value as a proposal, writes it only with
  `--apply`, and refuses to guess at a batch v1 left unnamed unless `--assign <old>=<integration-name>`
  supplies it. Two v1 batches that claimed one integration now fold into a single batch (member order
  preserved, dropped notes reported) instead of being coordinated by prose.

    `sandcastle queue land --name <batch>` closes the seam between "the agents finished" and "it is on
    main": it composes the batch on its integration branch — conflict resolution and the integration
    review are agents, and an unfinished composition resumes rather than restarting — then prints the
    `git push` and `gh pr create` commands, or runs them under `--create-pr`. The PR body carries one
    `Closes #<n>` per member, so merging it closes the batch's issues natively, which in turn clears
    their `blocked-by` edges for later batches. The merge itself stays human: nothing in sandcastle runs
    `gh pr merge`. `queue run --land` lands each batch it dispatches, `queue land --finish` removes a
    batch whose members have closed and clears the `after` references pointing at it, and
    `queue sequence --delete` refuses while another batch still waits on the batch being deleted. Dangling
    `after` references are reported as drift by `queue list` / `queue check`.

    Every batch already branched from `--base`, so nothing stacks on an unlanded integration; the docs,
    help topics, and the bundled skill now say so in one place, and `queue bootstrap` proposes batch names
    in the `<scope>-work` shape an integration name needs.

    This is a breaking change for any existing `sandcastle.queue.json`: run `sandcastle queue migrate
--apply` (adding `--assign` for batches v1 left unnamed) before the next `queue list`.

### Minor Changes

- [`1f3808d`](https://github.com/lisachandra/rbxts/commit/1f3808d6a888aa53336ddeae0c926afb3a608417) Thanks [@lisachandra](https://github.com/lisachandra)! - Add a `sandcastle queue` command group (`add`, `sequence`, `rule`, `remove`, `list`, `check`) backed by a git-tracked `sandcastle.queue.json` manifest (path configurable via `queue.file` in `sandcastle.config.ts`). GitHub issues stay canonical for issue state; the manifest records batch composition/run order, serialization rules, and gates. `queue list` renders a live READY/GATED view with drift detection, and `queue check` exits non-zero when the queue and GitHub disagree. Review prompts now register follow-up issues via `sandcastle queue add` and verify with `sandcastle queue check` instead of hand-editing consumer markdown queue docs.

- [`961e488`](https://github.com/lisachandra/rbxts/commit/961e488799cffb34c21bd30a08f5ce56df085571) Thanks [@lisachandra](https://github.com/lisachandra)! - Add `sandcastle queue graph`, the queue rendered for a human: batches as nodes in run order, with edges for `afterMerge` gates, `serialized` rules, and live cross-batch blocked-by links. Mermaid is the default (GitHub draws it natively in files, issues, PRs, and comments), `--format json` prints the payload for tooling, `--format ascii` previews it in a terminal, `--write <path>` emits a timestamp-free Markdown page a CI drift check can diff, `--comment <n>` posts that page to a tracker issue and updates its own comment on re-run, and `--expand-issues` draws each batch as a subgraph of its members. The command is read-only and never writes the manifest.

- [`3478558`](https://github.com/lisachandra/rbxts/commit/347855819faadfa4ddbd90009657192a1cc3e8ac) Thanks [@lisachandra](https://github.com/lisachandra)! - Give every command its own `--help`: `sandcastle <command> --help` and `sandcastle queue <subcommand> --help` print that command's usage, flags, and exit codes instead of the shared global dump, and help is answered before argument validation, so `sandcastle queue add --help` no longer errors. `sandcastle queue run` exits 1 when nothing can fire (unknown `--name`, exhausted queue) so a scripted run fails loudly, `--json` reports each decision as one JSON object, and `sandcastle queue prune --closed` (`--dry-run` reports first) drops references to closed issues — the state that otherwise gates a batch forever.

- [`e60a032`](https://github.com/lisachandra/rbxts/commit/e60a0321ee1fc10fbe30fa9a18bf24f3e2e502b7) Thanks [@lisachandra](https://github.com/lisachandra)! - Add readable batch labels and enforceable run-order gates to the queue manifest.

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

- [`65add42`](https://github.com/lisachandra/rbxts/commit/65add421f4456f3e507929b4d18e20406a4adbfe) Thanks [@lisachandra](https://github.com/lisachandra)! - Give the queue the exits it was missing. Sequences can be deleted (`sandcastle queue sequence --name <batch> --delete`), `queue prune` drops sequences its removals emptied, and an empty sequence is now `EMPTY` in `queue list` and drift in `queue check` instead of reading as `READY` forever. Gated issues can be promoted once their conditions resolve: `sandcastle queue promote --issue <n> [--sequence <batch>]` promotes one gate into its title-scope batch, `sandcastle queue promote --apply` promotes every promotable gate, `queue bootstrap` proposes the same promotions under `--apply` (gated entries were previously ignored forever, so a gate could only be cleared by hand), and `queue run --promote-gates` applies them before selection. The manifest commit now verifies the primary checkout is on `queue.commitBranch` (default `baseBranch`) and reports the branch it committed to, leaving unrelated branches alone unless `--queue-commit-any` is passed.

- [`276fe80`](https://github.com/lisachandra/rbxts/commit/276fe801a2440552dc3f7080cb1d3ee5b49c7882) Thanks [@lisachandra](https://github.com/lisachandra)! - Make the queue workflow runnable end to end. `sandcastle queue run` dispatches the next READY sequence, re-reads the manifest after every batch (so a review that registered a follow-up changes what runs next inside the same invocation), prunes landed entries unless `--keep-entries`, and caps one invocation with `--max-issues <n>`. `sandcastle queue bootstrap [--apply]` proposes placements for the unplaced backlog grouped by title scope. Add a bypass for repositories that do not want the queue workflow — `queue.enabled: false` in `sandcastle.config.ts`, or `--no-queue` / `--queue` per invocation — backed by `queueRulesForPrompt()` instead of hard-coded queue instructions in the review prompts, and `queue.commit` (`--queue-commit`) so a review's registration is committed instead of dying with its worktree. The manifest now resolves against the primary checkout, `queue check --strict-gates` exits 2 when a gate is promotable, and the CLI accepts `--apply`, `--keep-entries`, `--max-issues`, `--queue`, `--no-queue`, `--queue-commit`, and `--strict-gates`.

- [`4a7bc5f`](https://github.com/lisachandra/rbxts/commit/4a7bc5f7e8a90d68e764ad1221b7ceede9fb2055) Thanks [@lisachandra](https://github.com/lisachandra)! - Let `queue sequence` delete a batch, keep a redefinition's run order, and move a batch on purpose.

    - `--delete` is reachable from the CLI. `ops.ts` supported it and needed no `--issues`, but the
      argument validator demanded `--issues` for every `queue sequence` call, so the flag could never be
      used — and the drift message that reported a memberless batch told you to run a positional form
      that never parsed. `pnpm sandcastle queue sequence --name <batch> --delete` now drops the batch,
      with `--issues` optional, and `--delete` is rejected outside `queue sequence`.
    - A redefinition keeps its position. `defineSequence` appended, so replacing a batch's membership or
      labels silently moved it to the tail of the run order; folding two batches re-ranked the schedule
      and flipped which side of a serialization rule had to wait. Only a new batch joins the tail now.
    - `--before <batch>` and `--last` move a batch explicitly, so run order can be edited without
      hand-writing the manifest: `--before` places it ahead of another batch, `--last` moves it to the
      end. They are mutually exclusive, `--before` rejects an unknown target and a batch that names
      itself, and `--last` is refused together with `--delete`.
    - `queue sequence --help` documents the flags, and the memberless-batch drift line prints the
      command that works.

- [`a7bd68c`](https://github.com/lisachandra/rbxts/commit/a7bd68ca3f0edafecf7972e049330b3a68f958b9) Thanks [@lisachandra](https://github.com/lisachandra)! - Add `sandcastle queue serve`, an interactive local view of the queue graph. The command starts a `node:http` server on `127.0.0.1:4321` (see `--port`, `--host`, `--open`) that serves a React + xyflow page from `dist/web` alongside two JSON endpoints, `/api/graph` and `/api/queue` — both built from the same `computeQueueView` the CLI renders, so the page and `queue list` cannot disagree. `?strict=1` reads the strict-gate view and `?refresh=1` bypasses the 30-second cache in front of the `gh` reads. The page lays batches out left to right with `@dagrejs/dagre`, draws gates, rules, blockers and the run-order spine as separately toggleable edge layers, filters batches by status, opens a per-batch panel with its members, roles, blockers, notes and merge branch, links GitHub issues, and deep-links a batch as `?batch=<name>`. Read-only, local-only, and gated behind `dist/web` having been built (`pnpm build`).

- [`65add42`](https://github.com/lisachandra/rbxts/commit/65add421f4456f3e507929b4d18e20406a4adbfe) Thanks [@lisachandra](https://github.com/lisachandra)! - Make queue dispatch safe to run unattended. `sandcastle queue run` now holds a run lock, so two dispatchers cannot overlap and a numbered serialization rule (`R<n>`) can no longer be broken by a second run starting mid-batch; every manifest mutation runs as one locked read-modify-write transaction, so a review registering a follow-up cannot lose a change made in another terminal, and the manifest is replaced atomically so a concurrent `queue list` never reads a half-written file. Dispatch resumes by default — a sequence that grew a new tail member re-fires the batch, and members that already completed with an APPROVED review are skipped while their branch still chains as the next base (`--no-resume` forces a clean re-run). `--max-issues <n>` no longer overshoots: a batch that would exceed the remaining budget is refused instead of partially run, because each member's branch is the next member's base. Add `--require-clean` to refuse a run while the queue reports drift (the default now warns), and make `--json` honest: stdout carries only JSON — one object for the single-shot subcommands, one per line for `queue run` — while progress, drift warnings, and commit notices move to stderr.

### Patch Changes

- [`0ad9a94`](https://github.com/lisachandra/rbxts/commit/0ad9a942c0ea54c246ee7e4fa41e0bd80f614e9e) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix the queue page's edge routing and document dispatch priority: batch cards expose handles on all four sides with direction-aware attachment and alternating side channels for constraint edges, dagre spacing grows with roomier truncated labels, order edges fade in lanes mode, and the legend/README/skill state that run order is dispatch priority (every batch starts from `--base`) with gated batches skipped until READY.

- [`276fe80`](https://github.com/lisachandra/rbxts/commit/276fe801a2440552dc3f7080cb1d3ee5b49c7882) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix queue registration defects: `sandcastle queue add --after <n>` silently moved the issue to the head of the batch when `<n>` named the issue being moved (it now throws), and a truncated `gh issue list` page was reported as "referenced but not found" drift instead of "not scanned", which made `queue check` fail on large repositories. `queue check` now exits 1 for drift and 2 when `--strict-gates` finds more, and the review prompts carry a `{{QUEUE_RULES}}` placeholder that must be kept when overriding `prompts.review` / `prompts.reviewIntegration`.

- [`65add42`](https://github.com/lisachandra/rbxts/commit/65add421f4456f3e507929b4d18e20406a4adbfe) Thanks [@lisachandra](https://github.com/lisachandra)! - Run every test in the package. `pnpm test` enumerates its files, so `src/help.test.ts`, `src/queue/persist.test.ts`, and `src/steps.test.ts` had never executed; all three now run and `src/test-suite.test.ts` fails the suite whenever a `src/**/*.test.ts` file is missing from the `test` or `test:coverage` script.

## 0.6.0

### Minor Changes

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Add per-step agent/model/effort overrides for every agent-driven step
  (`design`, `implement`, `review`, `planner`, `resolve`, `integrationReview`).

    - `sandcastle.config.ts`: `agents.steps.<step>` accepts `{ backend, model, effort }`;
      missing fields inherit the workflow default (`--agent` / `--model` / `--effort`
      plus `agents.models`).
    - CLI: `--<step>-model`, `--<step>-agent`, `--<step>-effort` flags (for example
      `--design-model`, `--implement-agent`, `--review-effort`, `--planner-model`,
      `--resolve-model`, `--integration-review-model`).
    - Precedence is CLI flag over `agents.steps` config over the workflow default.
      When a step selects a different backend without its own model, the mapped
      `agents.models[backend]` wins over the workflow model.
    - Issue runs thread `steps.design` / `steps.implement` / `steps.review` through
      design, implement, and review, persist them as `phasesConfig` in
      `.sandcastle/state/<issue>.json`, and re-evaluate the implement phase against
      its own model. `runAll` uses `steps.planner`; integrations use `steps.resolve`
      and `steps.integrationReview`. `--dry-run` and `--status` report the resolved
      per-step map.

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Stop integration composition from dying on uncommitted worktree drift

    Integration worktrees are long-lived and shared, so setup commands (`fetch-places`, submodule
    checkouts, generated files) and agent validation runs (`lint:fix`, builds, tests) regularly
    leave tracked files modified. When a source branch also touched one of those files, `git merge`
    aborted with "Your local changes to the following files would be overwritten by merge" —
    a message the conflict resolver cannot act on, and which the runner reported as
    `conflict-resolution-required`, so every resume replayed the same failure.

    - `integrateManifestSource` now pre-flights the worktree with `git status` before merging.
      Without the new flag it fails fast, naming the blocking paths and the remedy, and the manifest
      records the new `blocked` status (only genuine unmerged paths map to
      `conflict-resolution-required`).
    - New `--quarantine-drift` flag on `merge`, `merge-integrations`, and `integration-resume`
      stashes the blocking paths (`git stash push -m "sandcastle <name>: pre-merge drift"`) and
      records the resulting stash commit on the manifest (`.drift`), so nothing is lost and the
      operator can restore it with `git stash apply <commit>`.
    - `integration-status` prints the quarantined paths plus the restore command.
    - Submodule gitlinks are reported but never treated as blockers: git merges over them, as
      `pnpm setup` / `pnpm submodules` routinely leave them dirty.
    - Untracked files are ignored throughout, because worktree symlinks (`.agents`, `.diracrules`,
      `creator-docs`, `.sandcastle/plans`) must never be quarantined.

    New helpers: `dirtyPaths`, `changedSinceMergeBase`, and `isGitlink` in `git.ts`;
    `partitionDrift`, `quarantineWorktreeDrift`, and `prepareWorktreeForMerge` in `integrations.ts`.

- [`7fdcb7a`](https://github.com/lisachandra/rbxts/commit/7fdcb7aff7dd1e1dc814c70726a8c5c6b00e9646) Thanks [@lisachandra](https://github.com/lisachandra)! - Add a standalone `sandcastle setup` command that prepares a worktree for agent runs
  from `sandcastle.config.ts` without starting an agent. It creates the runner's state
  directories (`.sandcastle/{worktrees,logs,plans,state,integrations}`), copies the repo
  `.env` when present, runs the configured `setupCommands`, and links configured
  `symlinks` — the same preparation issue and integration runs perform implicitly.

    The command is config-driven and idempotent:

    - `sandcastle setup` — prepare the current directory (e.g. a clean paseo worktree)
    - `sandcastle setup --worktree <path>` — prepare an existing worktree path
    - `sandcastle setup --branch <name> [--base <ref>]` — create/reuse a registered worktree
      under `.sandcastle/worktrees/` and prepare it
    - `--ignore-setup` / `--skip-setup` / `--dry-run` behave like the issue workflow flags

    The `.env` copy and symlink linking moved into the shared `setupWorktree` helper, so
    supplied (`--worktree`) issue runs and integration worktrees get consistent preparation.

### Patch Changes

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Internal refactor: split integration composition into deep, testable modules

    The integration subsystem previously lived as a single `integrations.ts` monolith mixing
    manifest CRUD, worktree preparation, git merge plumbing, conflict helpers, and the
    `continueIntegration` state machine. This change extracts three cohesive modules behind clean
    seams with zero wire-format, schema, branch-naming, marker, or CLI changes:

    - `integration/manifest.ts` owns the manifest lifecycle: path resolution, validation, JSON
      read/write, and creation, with an injectable `ManifestFs` and source-resolution helpers.
    - `integration/merger.ts` owns the git merge contract: clean-resolution assertions, drift
      handling (`quarantineWorktreeDrift`, `prepareWorktreeForMerge`), and the per-source merge
      loop (`integrateManifestSource`), gated behind an injectable `MergerDeps` seam.
    - `integration/orchestrator.ts` owns the state machine for `continueIntegration` plus the
      lifecycle commands (`runNewIntegration`, `resumeIntegration`, `printIntegrationStatus`,
      `abortIntegration`, `cleanupIntegration`) and the marker-backed agent phases, delegating
      worktree preparation to the shared `setupWorktree`.

    `integrations.ts` is now a thin backwards-compatible barrel re-exporting the three modules;
    `main.ts` and every existing caller keep the same import surface unchanged.

- [`5ab96f3`](https://github.com/lisachandra/rbxts/commit/5ab96f35ea20589bf4c3cc7965caf17e74d31877) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix `linkSymlinks` failing to link junctions whose parent directory does not exist.

    On Windows, `symlinkSync(..., "junction")` throws `ENOENT` when the link's parent
    directory is missing. For `symlinks` entries nested under gitignored paths (e.g.
    `.sandcastle/plans`), `git worktree add` never creates the parent, so every fresh
    worktree failed to link the plans junction — the agent then wrote plan files into a
    real `<worktree>/.sandcastle/plans` directory that looked correct but was not shared
    with the repo.

    `linkSymlinks` now creates the parent directory before linking, and when a real
    directory already occupies the link path (a plan agent's drifted `plans/`), it
    replaces the directory with a junction while preserving its contents into the target.
    Re-running `sandcastle setup` on an affected worktree repairs the junction without
    losing any plans already written by agents.

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix log timestamps and dirac effort handling.

    - Log `Run started` markers now pair the UTC timestamp with local wall-clock
      time (`2026-09-06T00:00:00.000Z (local: 2026-09-06 07:00:00 GMT+07:00)`), so
      operators in timezones like GMT+7 see their wall clock. Stored state
      timestamps stay UTC ISO for machine comparison.
    - Effort `max` is forwarded untouched to dirac (`--reasoning-effort max` —
      dirac natively supports it via `OPENAI_REASONING_EFFORT_OPTIONS`) instead of
      being downgraded to `xhigh` with a bogus warning. The `max` to `xhigh`
      mapping (and warning) is kept only for backends that genuinely cap at
      `xhigh` (`pi`, `codex`).

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Simplify agent logs back to one live file, plus a dirac-only digest.

    - `.log` files are plain upstream file-mode logs again (`FileDisplay` output
      with `verbose: true`, matching pre-split behavior). The split-file
      machinery (`splitFileLogging`, `postProcessAgentLog`, `.raw.log`,
      `.readable.log`) is removed; leftover `.raw.log` / `.readable.log` files
      from earlier runs can be deleted.
    - Dirac runs additionally stream a clean markdown digest
      (`issue-<n>.dirac.log`, same rendering as the old `.readable.log`) live as
      agent events arrive, so the readable output exists from run start and
      survives failures — no more waiting for an end-of-run post-process step.

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Modularize the agent-provider bundle and unify issue-metadata fetching.

    - Each agent backend (`pi`, `codex`, `dirac`, `cursor`, `copilot`, `opencode`,
      `claude-code`) is now an adapter module under `src/providers/`, keeping its
      argument mapping and effort constraints localized. `createAgent` and
      `resolveBackendEffort` remain the single public entry point and still wrap
      every provider with the marker-completion proxy.
    - `withMarkerCompletion` moved to `src/providers/marker.ts`; `skillsForPrompt`
      and `uniqueSkills` moved to `src/prompts/skills.ts`.
    - New `issueMetadata(issueNumber, gh?)` seam in `src/issue-metadata.ts` is the
      single owner of the `gh issue view` title/label fetch (injectable `gh` runner,
      defaulting to `io.execSync`). `issue.ts` and `status.ts` now call it directly
      instead of re-implementing the shell fetch. `issueView` and
      `fetchIssueLabels` remain exported for backwards compatibility.

    No CLI arguments, config schemas, prompt files, wrapper scripts, or the marker
    protocol line change.

## 0.5.0

### Minor Changes

- Run the same worktree preparation used by issue runs (`.env` copy, `setupCommands`, and
  `symlinks`) before integration merge/resume agents start. `--ignore-setup` and `--skip-setup`
  now apply to `merge`, `merge-integrations`, and `integration-resume` as well.

## 0.4.0

### Minor Changes

- Add `--skip-setup` to skip the configured setup commands for issue, issue-all, and
  issue-sequence runs while still linking configured symlinks.

### Patch Changes

- `--ignore-setup` now links configured symlinks even when the setup command fails, instead of
  skipping the remainder of the setup step.

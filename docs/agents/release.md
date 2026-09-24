# Release And Milestone Policy

Release info lives here, not `AGENTS.md`: policy detail, rare workflow, human decision surface.

## Commands

| Need                                                        | Command          |
| ----------------------------------------------------------- | ---------------- |
| Add a changeset for the current work                        | `pnpm changeset` |
| Bump versions, write CHANGELOGs, delete the changeset files | `pnpm version`   |
| Publish bumped public packages to npm + tag                 | `pnpm release`   |

`.changeset/config.json` is the source of truth (`baseBranch: main`, `access: public`,
`updateInternalDependencies: patch`, `changelog-github`). Never hand-edit a package `CHANGELOG.md`
or a version field — the changeset flow owns both.

## Release Rules

- Behavior changes ship with a changeset **in the same commit**: `pnpm changeset`, pick the packages,
  pick the bump, write the summary.
- Bump by impact, not by effort: `patch` for fixes and internal refactors, `minor` for new API or
  new opt-in behavior, `major` for breaking API/behavior changes. A major bump requires a migration
  note in the changeset body.
- `@lisachandra/{core,matter,platform,ui,react-router,react-template}` are at `1.0.0` and above, so
  SemVer is enforced. `@lisachandra/{types,test,sandcastle}` are pre-1.0 and may take breaking
  changes as `minor`.
- One commit may carry several changesets when user-facing behaviors differ. Check existing
  changesets first and avoid duplicates.
- Write the changeset summary in the same voice as the commit subject (conventional prefix +
  outcome), not as a changelog entry — `changelog-github` formats it and credits the PR author.
- Private packages (`test/*`, and `packages/sandcastle` if unpublished) need no changeset; they are
  never published.
- No changeset for docs-only changes, formatting, or partial experiments.

## Milestone Rules

- Tag only reviewable, rollback-worthy, consumer-facing releases: a package that a game can pin.
- A tag means "this is what downstream games should upgrade to", not "work stopped here".
- Cut releases at coherent package boundaries; do not tag to mark progress through a plan.

## Release Workflow

`.github/workflows/release.yaml` is manual (`workflow_dispatch`) and does the work:

1. Validates `pnpm build`, then `pnpm test` when Open Cloud secrets are present.
2. Counts `.changeset/*.md` — with none, it stops after validation.
3. Runs `pnpm version`, commits `chore(release): version packages`, publishes with `pnpm release`
   (which also runs `changeset tag`), and pushes with `--follow-tags`.

## Agent Behavior

- Do not cut a release, run `pnpm version`, or push tags unless the user explicitly asks.
- If a task finishes release-worthy work, say so and offer the changeset bump — do not create one
  silently for a private package.
- Include release commands in the final summary only when relevant.

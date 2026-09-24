# Domain Docs

Use repo domain docs before naming product concepts, issues, tests, refactors.

## Read First

- `AGENTS.md` at repo root — package map, architectural patterns, conventions.
- `README.md` at repo root — consumer-facing description of the suite.
- Package docs: `packages/<name>/README.md` and the exported TSDoc in `packages/<name>/src`.
- Relevant plans and specs in `docs/superpowers/`.
- API docs under `creator-docs/` (submodule) for Roblox engine behavior.

Missing file? Proceed silently. Do not propose creating it upfront. Create or update only when domain
terms or architectural decisions get resolved.

## Repo Shape

Monorepo, one published package per concern:

```text
/
├── AGENTS.md
├── docs/agents/          # agent playbooks (this file's directory)
├── docs/superpowers/     # plans + specs
├── packages/<name>/      # @lisachandra/<name> — the published surface
├── test/<name>/          # per-package Jest Roblox suites
└── patches/              # hand-maintained pnpm patches (see patches/README.md)
```

Domain vocabulary is split by owner:

- Package `README.md` + TSDoc define the public vocabulary a consumer sees.
- `docs/superpowers/specs` defines in-flight design vocabulary.
- Test names in `test/<name>` record the behavior that vocabulary promises.

## Vocabulary

Use the terms packages already export in issue titles, proposals, hypotheses, tests.

Do not drift to synonyms the API avoids, and do not rename a concept in prose while the code keeps
the old name — either rename both or use the existing term.

Missing concept means either wrong language or a real gap. Reconsider first.

## Conflicts

If output contradicts an accepted plan, spec, or a changeset that already shipped, say so
explicitly:

> Contradicts the design in `docs/superpowers/specs/<file>.md` — worth reopening because ...

A shipped changeset (and the CHANGELOG entry it produced) is a contract with consumers: reopening it
is a new breaking change, not an edit.

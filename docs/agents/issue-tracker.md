# Issue Tracker

GitHub Issues are source of truth for PRDs, roadmap slices, AFK handoff. Use `gh` CLI against
`lisachandra/rbxts`.

## Workflow

1. Grill/shape the idea in chat.
2. Convert to a spec with when all decisions are settled (land it in `docs/superpowers/specs/`).
3. Break the spec into tracer-bullet slices.
4. Publish narrow implementation slices as issues, scoped to the package they change.
5. Apply labels from `docs/agents/triage-labels.md` and the metadata contract below.
6. Add `ready-for-agent` only after the issue passes the readiness review.
7. Sandcastle (`packages/sandcastle`, root `pnpm sandcastle:issue`) picks up a `ready-for-agent`
   issue in an isolated worktree. `pnpm issues:agent-ready` lists the queue.
8. Human reviews/validates before merge.

## Issue Metadata Contract

Read this section before creating or editing a GitHub issue. Issue titles use the same conventional
prefix vocabulary as commits, while remaining specific to the work:

- `feat(scope): ...` — new package or consumer behavior
- `fix(scope): ...` — correction of broken behavior
- `refactor(scope): ...` — structural change without behavior change (breaking if the API moves)
- `test(scope): ...` — test-only work
- `chore(scope): ...` — tooling, dependencies, release plumbing
- `docs(scope): ...` — documentation

Scope is the affected package (`core`, `matter`, `ui`, `platform`, `react-router`, `sandcastle`,
`repo` for cross-cutting work) in lowercase. Do not use a vague title such as `improve matter
replication`; name the concrete outcome instead.

Every issue must have the correct:

- milestone, matching its parent map or roadmap pass;
- parent/sub-issue relationship, when it belongs to a map;
- native `blocked-by` relationships for prerequisites;
- lifecycle and domain labels;
- `ready-for-agent` label only after implementation readiness review.

Relationship direction is explicit: if issue A cannot start until issue B is resolved, A is
**blocked by** B.

```bash
gh issue edit A --parent MAP
gh issue edit A --add-blocked-by B
```

Issues that change a published package must state in the body which packages are affected and what
the expected bump is (`patch` / `minor` / `major`); the implementing agent then writes the changeset
(see `docs/agents/release.md`).

## Wayfinding operations

A wayfinding effort is a **map** plus its **tickets**. How this repo expresses them:

- **Map** — one issue labelled `wayfinder:map`. Its body carries `## Destination`, `## Notes`, `## Decisions so far` (the index: one line per closed ticket), `## Not yet specified` (in-scope fog), `## Out of scope`. The map is an index — a decision lives in its ticket, never restated on the map.
- **Ticket** — a child issue of the map (`--parent`), labelled `wayfinder:<type>`: `research` (AFK), `prototype`, `grilling`, `task`. One decision per ticket, sized to one session.
- **Claim** — assign the dev and add `wayfinder:claimed`, **before** any work. An open, unassigned ticket is unclaimed; concurrent sessions skip it.
- **Blocking** — native `blocked-by` only. A ticket is unblocked when every ticket blocking it is closed.
- **Frontier** — the open, unclaimed, unblocked tickets, in one query:

```bash
gh api graphql -f query='{ search(query: "repo:lisachandra/rbxts is:issue is:open label:wayfinder:grilling,wayfinder:task,wayfinder:research,wayfinder:prototype no:assignee", type: ISSUE, first:100) { nodes { ... on Issue { number title blockedBy(first:20){nodes{number state}} } } } }' \
  --jq '.data.search.nodes[] | select([.blockedBy.nodes[]|select(.state=="OPEN")]|length==0) | "#\(.number) \(.title)"'
```

The query is the **raw frontier, not a queue**: a ticket can be unblocked and still be undecidable in
one session — it needs a look at engine behavior, a Rojo/Studio run, or a maintainer decision. Read
the body before claiming.

- **Resolve** — post the decision as a **resolution comment**, close the issue, then append one index line to the map's `## Decisions so far`. A closed ticket's contract lives in its **comments**; its body is often boilerplate. New work the answer reveals becomes a fresh child ticket, fog graduates into tickets, and work past the destination is closed and listed under `## Out of scope`.
- **One ticket per session** (research excepted). The decisions are the human's — drive the interview, never answer for them. Refer to a map or ticket by its **title** wrapping the link, never a bare number.

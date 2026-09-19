---
"@lisachandra/sandcastle": patch
---

Modularize the agent-provider bundle and unify issue-metadata fetching.

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

---
"@lisachandra/sandcastle": minor
---

Single-session mode: design → implement → review as one continuous agent conversation

The three phases were always three separate conversations. The implementer received the plan as a
file and the reviewer received the diff, so each reconstructed reasoning it never witnessed — the
plan's "why" was compressed into prose for a stranger, and the reviewer had no access to the
decisions that produced the code it was judging.

`--single-session` (or `agents.singleSession: true` in `sandcastle.config.ts`) chains the three
phases through one session instead: design runs, the implementer resumes that conversation, and the
reviewer resumes it again.

- Only the session scope moves. Each phase keeps its own prompt, completion marker, state slot,
  phase budget, retry loop, and per-phase model/effort selection, so `--phase`, `--force <phase>`,
  `--resume`, budget enforcement, failure attribution, and the review landing gate behave exactly as
  in split mode. Split mode remains the default.
- Split mode stores one session per phase; single-session stores one under `<issue>.session`, which
  is what makes each phase resume the previous one's conversation.
- A broken link in the chain (a cleared, expired, or unreachable session) degrades to a fresh
  conversation for that phase with a warning, rather than failing the phase: the marker requirements
  are what define phase success, and they are unchanged.
- Resume is a per-backend capability, so the mode is too. An explicit `--single-session` on a
  backend that cannot resume (`claude-code`, `codex`, `copilot`, `cursor`, `opencode`, `pi`) is
  refused with the offending phases named instead of silently running three separate conversations.
  A repository-level `agents.singleSession: true` default only warns and falls back to split mode,
  because a config default should not make the tool unusable on the backend the repo actually uses.
- `--phase` and `--single-session` are contradictory and refused together: `--phase` isolates one
  phase, single-session exists to chain all three.
- `--no-single-session` overrides a repository default for one invocation and is forwarded to
  parallel lanes, so a lane behaves like a serial run.
- The prompts gained a `{{SESSION_NOTE}}` variable: empty in split mode, and in single-session mode a
  paragraph telling each phase that the plan, diff, or review subject is its own earlier work (write
  the plan for your future self; do not re-litigate the plan you wrote; review your own work
  adversarially rather than restating your reasoning as justification).
- `planner`, `resolve`, and `integrationReview` are unaffected — they are not part of the issue phase
  chain.
- Single-session mode announces itself once, before the first phase:
  `▶ Single session: design → implement → review (#<n>)`.

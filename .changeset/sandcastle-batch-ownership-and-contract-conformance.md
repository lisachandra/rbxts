---
"@lisachandra/sandcastle": minor
---

A follow-up goes to the batch that owns the seam, and a contract contradiction is filed as itself

- `queueRulesForPrompt` now opens the registration contract with an ownership step: search the
  manifest for the files and modules the finding names, and register the work against the batch
  that already owns them instead of appending it to the running one. A finding that needs a
  subsystem the reviewed issue never touched is a new ticket, owned by the batch that owns that
  subsystem — not a follow-up to the issue that found it.
- The contract also requires a contradiction to be filed as its own ticket naming the ticket it
  contradicts (and whether that ticket is being amended, with the ADR named), and a duplicate search
  before filing a second issue.
- `--after <this-issue>` is now conditioned on this issue being the batch's **last** member:
  inserting before a member that already ran leaves that member's branch behind the insertion, and
  `queue land` then refuses a tail that moved. A tail growing faster than the head is named as the
  signal to prefer `--gated` over appending.
- `plan-prompt.md` gains a Contracts obligation: read the **closed** decision tickets and ADRs the
  modules you will touch cite, name the queue batch that owns them, and stop at the readiness gate
  when the issue as written would contradict one.
- `implement-issue.md` forbids building a second of anything that already exists — a ticket issuer,
  an admission barrier, a store adapter, an envelope validator — and asks the implementer to
  re-read the closed acceptance criteria its modules cite before the final commit.
- `review-issue.md` gains a **Contract conformance** checklist section and a rule that `APPROVED` on
  a branch contradicting a closed contract is correct only when the contradiction is filed as its
  own ticket; `review-integration.md` checks the composed batch against the closed contracts its
  members cite and against every other batch's membership.
- `docs/skills/sandcastle/SKILL.md` mirrors all of it, so a manual review reads the same contract as
  an agent.

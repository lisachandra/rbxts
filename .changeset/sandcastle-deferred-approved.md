---
"@lisachandra/sandcastle": minor
---

A deferred-by-design follow-up is APPROVED, not BLOCKED

- `review-issue.md` verdict now says what #442 taught us: a branch that is right for its scope is APPROVED once every deferred slice is filed as a follow-up issue, queue-registered, and listed — the batch continues and the next member chains this branch. BLOCKED is reserved for a branch that is itself wrong and must not chain, and the prompt says the batch stops at a BLOCKED member.
- `queueRulesForPrompt` ties the verdict to placement: `--sequence <batch> --after <this-issue>` when the follow-up directly continues the reviewed issue, plus the APPROVED-vs-BLOCKED rule in the shared registration block. The running-batch paragraph carries the same `--after` hint.
- `docs/skills/sandcastle/SKILL.md` mirrors both rules so manual reviews and agents read the same contract.

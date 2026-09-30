---
"@lisachandra/sandcastle": minor
---

Review verdicts: what `BLOCKED` means, and a budget for slow suites

Behaviour changes:

- `review-issue.md` defines the two verdicts. `APPROVED` is a branch that is right; `BLOCKED` is a
  branch that is wrong — a failing test, an unmet criterion, a finding left unfixed. A check the
  reviewer cannot finish inside its budget is neither: it runs the largest honest part, reports the
  command, the wall time, and what stayed unverified, and lets the verdict follow the code. That gap is
  what turned a 1100-second suite meeting a 300-second tool budget into a batch-wide abort.
- The same section says how to run a suite a repo documents as slow — detached, with a log, then poll —
  so a kill at the harness timeout reads as a missing run instead of a failing one.
- A `missing validation` entry in the review comment now names the command it ran, its wall time, and
  what stayed unverified.
- `plan-prompt.md` asks a plan to label every validation command `agent` or `operator`, so a manual
  Studio spot-check stops reading as something the branch owes.
- `implement-issue.md` covers lint alongside build for pre-existing unrelated errors, and asks for the
  report rather than silence.

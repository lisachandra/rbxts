---
"@lisachandra/sandcastle": patch
---

fix(sandcastle): keep an issue's commits when an implement re-run adds none

The implement phase recorded only the commits the sandbox made during that single run, and replaced
whatever the state already held. A re-run that found the work already on the branch therefore wrote
an empty list over the record of the run that did it, and `isIssueComplete` — which required a
non-empty list — reported a finished issue as unfinished. The phase evaluator disagreed, because it
counts the same thing from git, so the issue was skipped by nothing, re-dispatched forever, and left
its batch unable to empty.

Recorded commits are now combined with the ones a run produces instead of replaced, and the phase logs
when a run added nothing, so the log no longer reads "Commits: 0" over a branch that has three.
`isIssueComplete` falls back to counting the branch's commits against the state's base ref when the
recorded list is empty, which also repairs states that were already blanked without hand-editing them.

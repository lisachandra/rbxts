---
"@lisachandra/sandcastle": minor
---

Make the integration merge commit hook-proof, stop a failed hand-off from pruning its own batch, and
let a review continue the batch it came from.

- `integration.mergeSubject` (default `chore(integration): integrate {source}`) and
  `integration.verifyHooks` (default `false`) own the merge commit that composes an integration. The
  subject is conventional by default and the merge passes `--no-verify`, because a consumer with
  commitlint refused the old `Integrate <source>` subject and left the merge uncommitted.
- A merge that fails with no unmerged paths is abandoned (`git merge --abort`) and recorded as
  `blocked` with the real error, instead of surviving as `conflict-resolution-required` and sending a
  conflict-free merge to the resolver.
- `queue run --land` prunes a batch only when its hand-off completed. A failed land no longer removes
  its members from the manifest — which was drift, and left `queue land --name <batch>` unable to
  resolve a batch whose integration still needed composing. The Land hint is read back after the
  prune, so it never names a batch that is gone.
- `queue land` refuses a hand-off whose composition predates the batch's tail (`staleComposition`): a
  batch that grew a member after composition would otherwise open a PR that closes an issue whose
  commits it does not carry.
- Review prompts now name the batch: `queueRulesForPrompt({ batch })` tells a review to continue a
  running batch with `--sequence <that batch>` — `queue run` re-fires the batch and chains the new
  member's branch — while the composed integration phases are told a follow-up cannot join an
  already-composed batch. Both prompt files also prefer fixing a small in-scope finding on the branch
  over filing it as a new issue.
- `QUEUE_RULES` is injected only into the phases whose prompt references it, and the default review
  skills include `sandcastle`, so a review reads the queue contract rather than guessing at it.

# @lisachandra/sandcastle

## 1.1.0

### Minor Changes

- [`de50ea6`](https://github.com/lisachandra/rbxts/commit/de50ea642f54498e182028cb13f1438777bd8f29) Thanks [@lisachandra](https://github.com/lisachandra)! - Add `queue clean` to prune worktrees and integrations

  Nothing else in the command group removed `.sandcastle/worktrees/sandcastle-issue-<n>`, so issue and
  integration worktrees accumulated forever. `queue clean` is the one place that answers "what is safe
  to delete?", from live GitHub state plus the queue manifest rather than from file timestamps:

  - `--closed` an issue whose GitHub issue is closed, `--landed` a member whose review is APPROVED,
    `--stale` a worktree with no manifest placement and no live issue, `--integration-worktrees` a
    composition that reached a terminal status, `--all` every one of those.
  - `--drop-branch` also deletes the `sandcastle/issue-<n>` branch, `--reset` drops a terminal
    integration's worktree, branch, and manifest so it can be composed again, `--force` removes a
    worktree that is dirty or mid-merge, and `--dry-run` / `--json` report the plan first.

  It keeps any worktree that is still open and unapproved — cleaning is never a way to cancel work by
  accident — and never touches the primary checkout. Only `sandcastle/issue-<n>` branches at the
  runner's own worktree path are candidates, so a hand-made worktree is left alone.

- [`e134522`](https://github.com/lisachandra/rbxts/commit/e13452242e87121480310deebbe57a6bfb70d7b3) Thanks [@lisachandra](https://github.com/lisachandra)! - Make the integration merge commit hook-proof, stop a failed hand-off from pruning its own batch, and
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

- [`6b92c4d`](https://github.com/lisachandra/rbxts/commit/6b92c4d2e86230e1f066fc84a3447f8ef3cb8497) Thanks [@lisachandra](https://github.com/lisachandra)! - Rebuild a composition that no longer matches its batch with `queue land --recompose`.

  - `queue land` compares the integration manifest against the batch before handing it off, so
    divergence is caught before a resume re-merges the stale sources. Divergence is the batch's tail no
    longer being among the composed sources, a recorded source the batch no longer carries, or a member
    branch whose head moved after it was merged.
  - The refusal names the fix instead of `integration-abort`. That advice never worked: an aborted
    manifest was still resumed, so the same tail mismatch came straight back.
  - `--recompose` drops the composition (worktree, branch, manifest) and rebuilds it from the batch's
    current tail, in one command. A composition that did not finish — `blocked`, or any status short of
    landed — is rebuilt too, which is what made a failed merge unrecoverable.
  - `resetIntegration` is the new lifecycle command behind it: it marks the manifest `aborted` with a
    reason, removes the worktree and the integration branch, then deletes the manifest. Member branches
    are untouched, so resume still skips finished members.
  - `integration-status` prints the same comparison as a `Divergence:` block, so a batch that drifted
    says so when you inspect it rather than when you try to land it.

- [`ca61532`](https://github.com/lisachandra/rbxts/commit/ca6153228349442c8112314d8fcf69a43759cebc) Thanks [@lisachandra](https://github.com/lisachandra)! - Prompt contract: one injected completion block, and a review told what to fix

  Behaviour changes:

  - `{{COMPLETION}}` replaces the completion paragraph that was copied into all six prompt files. It
    is rendered by `src/prompts/completion.ts` with the marker path already interpolated, so no prompt
    has to carry a nested placeholder. `agent.test.ts` fails any prompt file that stops referencing
    it, and `{{MARKER_DIR}}`/`{{MARKER_PATH}}` are no longer prompt arguments.
  - The planner is passed only the arguments `plan-all.md` reads (`COMPLETION`, `READY_LABEL`).
    `BASE_REF`, `BRANCH`, `ISSUE_NUMBER`, `ISSUE_TITLE`, `PLAN_PATH`, and `SKILLS` were provided and
    never referenced, which the runner reported on every planning run.
  - `review-issue.md` no longer restates the follow-up contract. It named "missing tests" as
    follow-up material ten lines above the injected rule that calls a missing test a fix-here, so the
    file argued with `{{QUEUE_RULES}}`; the injected block is now the only owner of that rule.
  - `review-integration.md` gives `{{QUEUE_RULES}}` its own heading instead of indenting it under
    "Run relevant validation after corrections", and states the human-merge rule once.
  - `implement-issue.md` asks for the plan once instead of three times, and `plan-all.md` states its
    output rules once; the duplicated closing instructions are gone.
  - `docs/skills/sandcastle/SKILL.md` states the `after`-gate truth table's behaviour instead of
    reproducing it — `queue list` prints the state — and compresses the runner's dispatch guarantees.

- [`6ddba91`](https://github.com/lisachandra/rbxts/commit/6ddba91546434a64ca0df39db1f46786c607a3dd) Thanks [@lisachandra](https://github.com/lisachandra)! - Fail `queue run --land` when a hand-off failed, instead of reporting it only on stderr.

  - Exit 2 once a requested hand-off failed, after the loop has finished everything it can. Exit 1
    still means nothing could fire — an unknown `--name`, or no READY batch — so a scripted caller can
    tell the two apart. Dry runs and budget stops keep their current codes.
  - The failure is printed as a summary with a retry line: which batches failed, why, and
    `pnpm sandcastle queue land --name <batch>`. A failed land no longer exits 1 for the wrong reason,
    which hid "the queue needs a human" behind "there was nothing to run".
  - Under `--json`, every hand-off attempt emits `{ handOff: { batch, ok, error } }` alongside the
    per-decision object, and a failed invocation emits a `failures` summary.

- [`b40526e`](https://github.com/lisachandra/rbxts/commit/b40526e81a1cb0e6810192f67b98bf23b490766f) Thanks [@lisachandra](https://github.com/lisachandra)! - Review verdicts: what `BLOCKED` means, and where the full suite is owed

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
  - `review-integration.md` owns the full-suite run: once per batch, on the composed branch, detached and
    polled, with its wall time reported. The composed branch is what ships, so it is where the unbounded
    run belongs.
  - `plan-prompt.md` asks a plan to label every validation command `agent` or `operator`, so a manual
    Studio spot-check stops reading as something the branch owes.
  - `implement-issue.md` covers lint alongside build for pre-existing unrelated errors, and asks for the
    report rather than silence.

- [`f231346`](https://github.com/lisachandra/rbxts/commit/f231346b96ad7139813107b0a2f37b38e9e065e8) Thanks [@lisachandra](https://github.com/lisachandra)! - A follow-up goes to the batch that owns the seam, and a contract contradiction is filed as itself

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

- [`bf8fcc5`](https://github.com/lisachandra/rbxts/commit/bf8fcc541cfce23f0cee949687d8d4d74c2dd138) Thanks [@lisachandra](https://github.com/lisachandra)! - A deferred-by-design follow-up is APPROVED, not BLOCKED

  - `review-issue.md` verdict now says what [#442](https://github.com/lisachandra/rbxts/issues/442) taught us: a branch that is right for its scope is APPROVED once every deferred slice is filed as a follow-up issue, queue-registered, and listed — the batch continues and the next member chains this branch. BLOCKED is reserved for a branch that is itself wrong and must not chain, and the prompt says the batch stops at a BLOCKED member.
  - `queueRulesForPrompt` ties the verdict to placement: `--sequence <batch> --after <this-issue>` when the follow-up directly continues the reviewed issue, plus the APPROVED-vs-BLOCKED rule in the shared registration block. The running-batch paragraph carries the same `--after` hint.
  - `docs/skills/sandcastle/SKILL.md` mirrors both rules so manual reviews and agents read the same contract.

- [`c30ca17`](https://github.com/lisachandra/rbxts/commit/c30ca17ae24634fc02b1062b5d9be1e87e67df62) Thanks [@lisachandra](https://github.com/lisachandra)! - Registering a queue member ahead of an already-dispatched one is now refused

  `queue add --sequence <batch> --after <m>` throws when any later-position member of that batch
  has a `.sandcastle/state/<n>.json` — the marker the runner writes when it dispatches an issue —
  because each member's branch becomes the next member's base: an insertion ahead of a dispatched
  member leaves that branch behind the insertion and `queue land` refuses the moved tail. This is
  the harness-level guard behind the prose contract that already forbade it; the prompt text now
  says the harness enforces it.

  The refusal names the dispatched member, the batch, and the fix: append to the batch tail
  instead (omit `--after`), or register the work gated. Tail appends and gated/human placements
  are untouched, and dry-run reports the same refusal without writing.

- [`2b83228`](https://github.com/lisachandra/rbxts/commit/2b83228cf81324347b442057ee54ed0f1750743d) Thanks [@lisachandra](https://github.com/lisachandra)! - fix(sandcastle): prune a batch's members when GitHub closes them, not when the hand-off succeeds

  `queue run` pruned every member whose review was APPROVED as soon as a hand-off completed, so opening
  a pull request deleted the batch's record while that pull request was still open. Closing it without
  merging then lost the only list of what still had to land, and the still-open members reappeared as
  "not placed in the queue" drift.

  Pruning is now keyed on the merge. A member leaves the manifest when its issue is CLOSED, checked once
  per invocation before anything is selected, so a composed batch keeps its members — and its place in
  the queue — until the pull request actually lands. An emptied batch still has its `after` gates
  cleared in the same transaction, and `--keep-entries` still suppresses the whole pass.
  `mayPruneLanded` is gone with the hand-off gate it expressed.

- [`fab6357`](https://github.com/lisachandra/rbxts/commit/fab63570021d959f7ac8623e9086029bbbb284a7) Thanks [@lisachandra](https://github.com/lisachandra)! - Extend the mid-chain registration guard ([#503](https://github.com/lisachandra/rbxts/issues/503)) to batch redefinitions: `queue sequence --name X --issues ...` now refuses a redefinition that moves or drops a member which has already been dispatched. Dispatched members form the prefix the run already executed, and each member's branch is the next member's base, so a reorder leaves their branches behind the new order and `queue land` refuses the moved tail. The refusal names the first offending member and the fix — keep dispatched members first, in run order, and add new work after them (or register it gated). Refuses inside the manifest transaction, so a rejected redefinition writes nothing.

- [`c30ca17`](https://github.com/lisachandra/rbxts/commit/c30ca17ae24634fc02b1062b5d9be1e87e67df62) Thanks [@lisachandra](https://github.com/lisachandra)! - Serialization rules can now be retired, so a queue can be brought back to "no drift"

  `queue rule --delete --name <R#>` removes every rule carrying that name (one name may cover
  several issue sets), `--issues <a,b>` matches the rule whose sorted issue set is exactly that,
  and both together intersect. The command goes through the normal locked manifest write, prints
  each rule it retired, and exits non-zero naming the rule when nothing matches — it never
  silently no-ops. `--delete` is now accepted for `queue rule` (it stays reserved to `queue
sequence` otherwise), and the required-args gate only demands `--issues`/`--reason` when not
  deleting.

  The sorted issue set remains the add key, so narrowing a rule is retire-then-redeclare rather
  than an upsert: re-declaring a name with a narrower set still appends, which is exactly the
  append-only wart this unblocks cleaning up. A spec covers add → retire → re-declare narrower →
  drift zero.

### Patch Changes

- [`9a3acbc`](https://github.com/lisachandra/rbxts/commit/9a3acbc0e5ed4a7d72a86ed0cdc56c9fd2ebb41f) Thanks [@lisachandra](https://github.com/lisachandra)! - Stop a batch's own serialization rule from blocking its re-fire

  `queue run` re-read the manifest after every batch but could not act on what it read: `ruleConflicts`
  counted a rule whose already-dispatched issues were members of the candidate batch itself, so any
  batch holding two members of one `R<n>` rule conflicted with its own membership and could never
  re-fire. A review that registered a follow-up into the batch that had just run therefore never got to
  run it — the dispatcher silently fell through to the next READY batch. A rule now only conflicts when
  it couples the candidate with a _different_ batch.

  Two supporting changes:

  - `queue run` no longer falls through silently. When the batch it just ran grew members it cannot run,
    it stops and names that batch and the reason instead of starting unrelated work;
    `--continue-anyway` restores the old fall-through.
  - A landed member is skipped on a re-fire even when its worktree is gone, restoring the worktree from
    the branch. The branch is the durable artifact and the worktree is disposable, so pruning worktrees
    can no longer turn a re-fire into a full re-run of approved work.

  `queue check` now also reports a rule that couples two members of one batch, which position already
  serializes, so the rule is not mistaken for protection it does not provide.

- [`2b83228`](https://github.com/lisachandra/rbxts/commit/2b83228cf81324347b442057ee54ed0f1750743d) Thanks [@lisachandra](https://github.com/lisachandra)! - fix(sandcastle): keep an issue's commits when an implement re-run adds none

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

- [`06436c9`](https://github.com/lisachandra/rbxts/commit/06436c96029aac835871c8179d2134aca67da4a2) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix [#504](https://github.com/lisachandra/rbxts/issues/504): `queue prune --closed` was unrunnable. The parser gate reserved `--closed` for `queue clean` and rejected every other subcommand, while prune's own contract requires `--closed` — the command could never parse. The gate now exempts exactly that shape; `queue prune --all` and every other flag-batch mismatch stay refused.

## 1.0.0

### Major Changes

- [`1e03696`](https://github.com/lisachandra/rbxts/commit/1e03696ad5a585ed11b19f199ec125e6d899e68b) Thanks [@lisachandra](https://github.com/lisachandra)! - Give the queue a landing step, and one name per batch. A batch's `name` is now its integration name
  (`sandcastle/integration/<name>`) — the v1 split between a short code and a separate `mergeName` was
  two namespaces for one thing — and `afterMerge` is now `after`, so the manifest schema is version 2
  and `readQueueManifest` refuses a v1 file by name. `sandcastle queue migrate` translates one: it
  prints every rename, fold, and remapped `after`/`joins` value as a proposal, writes it only with
  `--apply`, and refuses to guess at a batch v1 left unnamed unless `--assign <old>=<integration-name>`
  supplies it. Two v1 batches that claimed one integration now fold into a single batch (member order
  preserved, dropped notes reported) instead of being coordinated by prose.

  `sandcastle queue land --name <batch>` closes the seam between "the agents finished" and "it is on
  main": it composes the batch on its integration branch — conflict resolution and the integration
  review are agents, and an unfinished composition resumes rather than restarting — then prints the
  `git push` and `gh pr create` commands, or runs them under `--create-pr`. The PR body carries one
  `Closes #<n>` per member, so merging it closes the batch's issues natively, which in turn clears
  their `blocked-by` edges for later batches. The merge itself stays human: nothing in sandcastle runs
  `gh pr merge`. `queue run --land` lands each batch it dispatches, `queue land --finish` removes a
  batch whose members have closed and clears the `after` references pointing at it, and
  `queue sequence --delete` refuses while another batch still waits on the batch being deleted. Dangling
  `after` references are reported as drift by `queue list` / `queue check`.

  Every batch already branched from `--base`, so nothing stacks on an unlanded integration; the docs,
  help topics, and the bundled skill now say so in one place, and `queue bootstrap` proposes batch names
  in the `<scope>-work` shape an integration name needs.

  This is a breaking change for any existing `sandcastle.queue.json`: run `sandcastle queue migrate
--apply` (adding `--assign` for batches v1 left unnamed) before the next `queue list`.

### Minor Changes

- [`1f3808d`](https://github.com/lisachandra/rbxts/commit/1f3808d6a888aa53336ddeae0c926afb3a608417) Thanks [@lisachandra](https://github.com/lisachandra)! - Add a `sandcastle queue` command group (`add`, `sequence`, `rule`, `remove`, `list`, `check`) backed by a git-tracked `sandcastle.queue.json` manifest (path configurable via `queue.file` in `sandcastle.config.ts`). GitHub issues stay canonical for issue state; the manifest records batch composition/run order, serialization rules, and gates. `queue list` renders a live READY/GATED view with drift detection, and `queue check` exits non-zero when the queue and GitHub disagree. Review prompts now register follow-up issues via `sandcastle queue add` and verify with `sandcastle queue check` instead of hand-editing consumer markdown queue docs.

- [`961e488`](https://github.com/lisachandra/rbxts/commit/961e488799cffb34c21bd30a08f5ce56df085571) Thanks [@lisachandra](https://github.com/lisachandra)! - Add `sandcastle queue graph`, the queue rendered for a human: batches as nodes in run order, with edges for `afterMerge` gates, `serialized` rules, and live cross-batch blocked-by links. Mermaid is the default (GitHub draws it natively in files, issues, PRs, and comments), `--format json` prints the payload for tooling, `--format ascii` previews it in a terminal, `--write <path>` emits a timestamp-free Markdown page a CI drift check can diff, `--comment <n>` posts that page to a tracker issue and updates its own comment on re-run, and `--expand-issues` draws each batch as a subgraph of its members. The command is read-only and never writes the manifest.

- [`3478558`](https://github.com/lisachandra/rbxts/commit/347855819faadfa4ddbd90009657192a1cc3e8ac) Thanks [@lisachandra](https://github.com/lisachandra)! - Give every command its own `--help`: `sandcastle <command> --help` and `sandcastle queue <subcommand> --help` print that command's usage, flags, and exit codes instead of the shared global dump, and help is answered before argument validation, so `sandcastle queue add --help` no longer errors. `sandcastle queue run` exits 1 when nothing can fire (unknown `--name`, exhausted queue) so a scripted run fails loudly, `--json` reports each decision as one JSON object, and `sandcastle queue prune --closed` (`--dry-run` reports first) drops references to closed issues — the state that otherwise gates a batch forever.

- [`e60a032`](https://github.com/lisachandra/rbxts/commit/e60a0321ee1fc10fbe30fa9a18bf24f3e2e502b7) Thanks [@lisachandra](https://github.com/lisachandra)! - Add readable batch labels and enforceable run-order gates to the queue manifest.

  - `sequences[].title` and `sequences[].roles` label a batch and its members. `queue list` renders
    the title beside the batch name, a role phrase beside each issue number, and every `notes` line
    under the membership — the readable half of the queue used to be invisible in the live view.
  - `sequences[].afterMerge` is a declared run-order gate: the batch stays GATED until that
    integration has been composed **and** its head commit is an ancestor of the base branch. It is
    evaluated in `queue/gates.ts` with `git merge-base --is-ancestor`, it fails closed, and it
    replaces the prose "runs only after X merged" that `queue run` never read.
  - `gated[].joins` names the batch an issue moves into. `queue promote` prefers it over the issue
    title's conventional scope, and a re-gate keeps it instead of dropping the target.
  - `defineSequence` keeps `afterMerge`, `notes`, `roles`, and `title` when a redefinition omits the
    flag, so `queue sequence --issues <a,b,c>` no longer strips a batch's labels.
  - New flags: `queue sequence --title <label> --roles <n=role,...> --after-merge <integration>`, and
    `queue add --joins <batch>`.

- [`65add42`](https://github.com/lisachandra/rbxts/commit/65add421f4456f3e507929b4d18e20406a4adbfe) Thanks [@lisachandra](https://github.com/lisachandra)! - Give the queue the exits it was missing. Sequences can be deleted (`sandcastle queue sequence --name <batch> --delete`), `queue prune` drops sequences its removals emptied, and an empty sequence is now `EMPTY` in `queue list` and drift in `queue check` instead of reading as `READY` forever. Gated issues can be promoted once their conditions resolve: `sandcastle queue promote --issue <n> [--sequence <batch>]` promotes one gate into its title-scope batch, `sandcastle queue promote --apply` promotes every promotable gate, `queue bootstrap` proposes the same promotions under `--apply` (gated entries were previously ignored forever, so a gate could only be cleared by hand), and `queue run --promote-gates` applies them before selection. The manifest commit now verifies the primary checkout is on `queue.commitBranch` (default `baseBranch`) and reports the branch it committed to, leaving unrelated branches alone unless `--queue-commit-any` is passed.

- [`276fe80`](https://github.com/lisachandra/rbxts/commit/276fe801a2440552dc3f7080cb1d3ee5b49c7882) Thanks [@lisachandra](https://github.com/lisachandra)! - Make the queue workflow runnable end to end. `sandcastle queue run` dispatches the next READY sequence, re-reads the manifest after every batch (so a review that registered a follow-up changes what runs next inside the same invocation), prunes landed entries unless `--keep-entries`, and caps one invocation with `--max-issues <n>`. `sandcastle queue bootstrap [--apply]` proposes placements for the unplaced backlog grouped by title scope. Add a bypass for repositories that do not want the queue workflow — `queue.enabled: false` in `sandcastle.config.ts`, or `--no-queue` / `--queue` per invocation — backed by `queueRulesForPrompt()` instead of hard-coded queue instructions in the review prompts, and `queue.commit` (`--queue-commit`) so a review's registration is committed instead of dying with its worktree. The manifest now resolves against the primary checkout, `queue check --strict-gates` exits 2 when a gate is promotable, and the CLI accepts `--apply`, `--keep-entries`, `--max-issues`, `--queue`, `--no-queue`, `--queue-commit`, and `--strict-gates`.

- [`4a7bc5f`](https://github.com/lisachandra/rbxts/commit/4a7bc5f7e8a90d68e764ad1221b7ceede9fb2055) Thanks [@lisachandra](https://github.com/lisachandra)! - Let `queue sequence` delete a batch, keep a redefinition's run order, and move a batch on purpose.

  - `--delete` is reachable from the CLI. `ops.ts` supported it and needed no `--issues`, but the
    argument validator demanded `--issues` for every `queue sequence` call, so the flag could never be
    used — and the drift message that reported a memberless batch told you to run a positional form
    that never parsed. `pnpm sandcastle queue sequence --name <batch> --delete` now drops the batch,
    with `--issues` optional, and `--delete` is rejected outside `queue sequence`.
  - A redefinition keeps its position. `defineSequence` appended, so replacing a batch's membership or
    labels silently moved it to the tail of the run order; folding two batches re-ranked the schedule
    and flipped which side of a serialization rule had to wait. Only a new batch joins the tail now.
  - `--before <batch>` and `--last` move a batch explicitly, so run order can be edited without
    hand-writing the manifest: `--before` places it ahead of another batch, `--last` moves it to the
    end. They are mutually exclusive, `--before` rejects an unknown target and a batch that names
    itself, and `--last` is refused together with `--delete`.
  - `queue sequence --help` documents the flags, and the memberless-batch drift line prints the
    command that works.

- [`a7bd68c`](https://github.com/lisachandra/rbxts/commit/a7bd68ca3f0edafecf7972e049330b3a68f958b9) Thanks [@lisachandra](https://github.com/lisachandra)! - Add `sandcastle queue serve`, an interactive local view of the queue graph. The command starts a `node:http` server on `127.0.0.1:4321` (see `--port`, `--host`, `--open`) that serves a React + xyflow page from `dist/web` alongside two JSON endpoints, `/api/graph` and `/api/queue` — both built from the same `computeQueueView` the CLI renders, so the page and `queue list` cannot disagree. `?strict=1` reads the strict-gate view and `?refresh=1` bypasses the 30-second cache in front of the `gh` reads. The page lays batches out left to right with `@dagrejs/dagre`, draws gates, rules, blockers and the run-order spine as separately toggleable edge layers, filters batches by status, opens a per-batch panel with its members, roles, blockers, notes and merge branch, links GitHub issues, and deep-links a batch as `?batch=<name>`. Read-only, local-only, and gated behind `dist/web` having been built (`pnpm build`).

- [`65add42`](https://github.com/lisachandra/rbxts/commit/65add421f4456f3e507929b4d18e20406a4adbfe) Thanks [@lisachandra](https://github.com/lisachandra)! - Make queue dispatch safe to run unattended. `sandcastle queue run` now holds a run lock, so two dispatchers cannot overlap and a numbered serialization rule (`R<n>`) can no longer be broken by a second run starting mid-batch; every manifest mutation runs as one locked read-modify-write transaction, so a review registering a follow-up cannot lose a change made in another terminal, and the manifest is replaced atomically so a concurrent `queue list` never reads a half-written file. Dispatch resumes by default — a sequence that grew a new tail member re-fires the batch, and members that already completed with an APPROVED review are skipped while their branch still chains as the next base (`--no-resume` forces a clean re-run). `--max-issues <n>` no longer overshoots: a batch that would exceed the remaining budget is refused instead of partially run, because each member's branch is the next member's base. Add `--require-clean` to refuse a run while the queue reports drift (the default now warns), and make `--json` honest: stdout carries only JSON — one object for the single-shot subcommands, one per line for `queue run` — while progress, drift warnings, and commit notices move to stderr.

### Patch Changes

- [`0ad9a94`](https://github.com/lisachandra/rbxts/commit/0ad9a942c0ea54c246ee7e4fa41e0bd80f614e9e) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix the queue page's edge routing and document dispatch priority: batch cards expose handles on all four sides with direction-aware attachment and alternating side channels for constraint edges, dagre spacing grows with roomier truncated labels, order edges fade in lanes mode, and the legend/README/skill state that run order is dispatch priority (every batch starts from `--base`) with gated batches skipped until READY.

- [`276fe80`](https://github.com/lisachandra/rbxts/commit/276fe801a2440552dc3f7080cb1d3ee5b49c7882) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix queue registration defects: `sandcastle queue add --after <n>` silently moved the issue to the head of the batch when `<n>` named the issue being moved (it now throws), and a truncated `gh issue list` page was reported as "referenced but not found" drift instead of "not scanned", which made `queue check` fail on large repositories. `queue check` now exits 1 for drift and 2 when `--strict-gates` finds more, and the review prompts carry a `{{QUEUE_RULES}}` placeholder that must be kept when overriding `prompts.review` / `prompts.reviewIntegration`.

- [`65add42`](https://github.com/lisachandra/rbxts/commit/65add421f4456f3e507929b4d18e20406a4adbfe) Thanks [@lisachandra](https://github.com/lisachandra)! - Run every test in the package. `pnpm test` enumerates its files, so `src/help.test.ts`, `src/queue/persist.test.ts`, and `src/steps.test.ts` had never executed; all three now run and `src/test-suite.test.ts` fails the suite whenever a `src/**/*.test.ts` file is missing from the `test` or `test:coverage` script.

## 0.6.0

### Minor Changes

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Add per-step agent/model/effort overrides for every agent-driven step
  (`design`, `implement`, `review`, `planner`, `resolve`, `integrationReview`).

  - `sandcastle.config.ts`: `agents.steps.<step>` accepts `{ backend, model, effort }`;
    missing fields inherit the workflow default (`--agent` / `--model` / `--effort`
    plus `agents.models`).
  - CLI: `--<step>-model`, `--<step>-agent`, `--<step>-effort` flags (for example
    `--design-model`, `--implement-agent`, `--review-effort`, `--planner-model`,
    `--resolve-model`, `--integration-review-model`).
  - Precedence is CLI flag over `agents.steps` config over the workflow default.
    When a step selects a different backend without its own model, the mapped
    `agents.models[backend]` wins over the workflow model.
  - Issue runs thread `steps.design` / `steps.implement` / `steps.review` through
    design, implement, and review, persist them as `phasesConfig` in
    `.sandcastle/state/<issue>.json`, and re-evaluate the implement phase against
    its own model. `runAll` uses `steps.planner`; integrations use `steps.resolve`
    and `steps.integrationReview`. `--dry-run` and `--status` report the resolved
    per-step map.

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Stop integration composition from dying on uncommitted worktree drift

  Integration worktrees are long-lived and shared, so setup commands (`fetch-places`, submodule
  checkouts, generated files) and agent validation runs (`lint:fix`, builds, tests) regularly
  leave tracked files modified. When a source branch also touched one of those files, `git merge`
  aborted with "Your local changes to the following files would be overwritten by merge" —
  a message the conflict resolver cannot act on, and which the runner reported as
  `conflict-resolution-required`, so every resume replayed the same failure.

  - `integrateManifestSource` now pre-flights the worktree with `git status` before merging.
    Without the new flag it fails fast, naming the blocking paths and the remedy, and the manifest
    records the new `blocked` status (only genuine unmerged paths map to
    `conflict-resolution-required`).
  - New `--quarantine-drift` flag on `merge`, `merge-integrations`, and `integration-resume`
    stashes the blocking paths (`git stash push -m "sandcastle <name>: pre-merge drift"`) and
    records the resulting stash commit on the manifest (`.drift`), so nothing is lost and the
    operator can restore it with `git stash apply <commit>`.
  - `integration-status` prints the quarantined paths plus the restore command.
  - Submodule gitlinks are reported but never treated as blockers: git merges over them, as
    `pnpm setup` / `pnpm submodules` routinely leave them dirty.
  - Untracked files are ignored throughout, because worktree symlinks (`.agents`, `.diracrules`,
    `creator-docs`, `.sandcastle/plans`) must never be quarantined.

  New helpers: `dirtyPaths`, `changedSinceMergeBase`, and `isGitlink` in `git.ts`;
  `partitionDrift`, `quarantineWorktreeDrift`, and `prepareWorktreeForMerge` in `integrations.ts`.

- [`7fdcb7a`](https://github.com/lisachandra/rbxts/commit/7fdcb7aff7dd1e1dc814c70726a8c5c6b00e9646) Thanks [@lisachandra](https://github.com/lisachandra)! - Add a standalone `sandcastle setup` command that prepares a worktree for agent runs
  from `sandcastle.config.ts` without starting an agent. It creates the runner's state
  directories (`.sandcastle/{worktrees,logs,plans,state,integrations}`), copies the repo
  `.env` when present, runs the configured `setupCommands`, and links configured
  `symlinks` — the same preparation issue and integration runs perform implicitly.

  The command is config-driven and idempotent:

  - `sandcastle setup` — prepare the current directory (e.g. a clean paseo worktree)
  - `sandcastle setup --worktree <path>` — prepare an existing worktree path
  - `sandcastle setup --branch <name> [--base <ref>]` — create/reuse a registered worktree
    under `.sandcastle/worktrees/` and prepare it
  - `--ignore-setup` / `--skip-setup` / `--dry-run` behave like the issue workflow flags

  The `.env` copy and symlink linking moved into the shared `setupWorktree` helper, so
  supplied (`--worktree`) issue runs and integration worktrees get consistent preparation.

### Patch Changes

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Internal refactor: split integration composition into deep, testable modules

  The integration subsystem previously lived as a single `integrations.ts` monolith mixing
  manifest CRUD, worktree preparation, git merge plumbing, conflict helpers, and the
  `continueIntegration` state machine. This change extracts three cohesive modules behind clean
  seams with zero wire-format, schema, branch-naming, marker, or CLI changes:

  - `integration/manifest.ts` owns the manifest lifecycle: path resolution, validation, JSON
    read/write, and creation, with an injectable `ManifestFs` and source-resolution helpers.
  - `integration/merger.ts` owns the git merge contract: clean-resolution assertions, drift
    handling (`quarantineWorktreeDrift`, `prepareWorktreeForMerge`), and the per-source merge
    loop (`integrateManifestSource`), gated behind an injectable `MergerDeps` seam.
  - `integration/orchestrator.ts` owns the state machine for `continueIntegration` plus the
    lifecycle commands (`runNewIntegration`, `resumeIntegration`, `printIntegrationStatus`,
    `abortIntegration`, `cleanupIntegration`) and the marker-backed agent phases, delegating
    worktree preparation to the shared `setupWorktree`.

  `integrations.ts` is now a thin backwards-compatible barrel re-exporting the three modules;
  `main.ts` and every existing caller keep the same import surface unchanged.

- [`5ab96f3`](https://github.com/lisachandra/rbxts/commit/5ab96f35ea20589bf4c3cc7965caf17e74d31877) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix `linkSymlinks` failing to link junctions whose parent directory does not exist.

  On Windows, `symlinkSync(..., "junction")` throws `ENOENT` when the link's parent
  directory is missing. For `symlinks` entries nested under gitignored paths (e.g.
  `.sandcastle/plans`), `git worktree add` never creates the parent, so every fresh
  worktree failed to link the plans junction — the agent then wrote plan files into a
  real `<worktree>/.sandcastle/plans` directory that looked correct but was not shared
  with the repo.

  `linkSymlinks` now creates the parent directory before linking, and when a real
  directory already occupies the link path (a plan agent's drifted `plans/`), it
  replaces the directory with a junction while preserving its contents into the target.
  Re-running `sandcastle setup` on an affected worktree repairs the junction without
  losing any plans already written by agents.

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix log timestamps and dirac effort handling.

  - Log `Run started` markers now pair the UTC timestamp with local wall-clock
    time (`2026-09-06T00:00:00.000Z (local: 2026-09-06 07:00:00 GMT+07:00)`), so
    operators in timezones like GMT+7 see their wall clock. Stored state
    timestamps stay UTC ISO for machine comparison.
  - Effort `max` is forwarded untouched to dirac (`--reasoning-effort max` —
    dirac natively supports it via `OPENAI_REASONING_EFFORT_OPTIONS`) instead of
    being downgraded to `xhigh` with a bogus warning. The `max` to `xhigh`
    mapping (and warning) is kept only for backends that genuinely cap at
    `xhigh` (`pi`, `codex`).

- [`8dc7e1e`](https://github.com/lisachandra/rbxts/commit/8dc7e1eb0f39d56bae7685945b962c76bbd2da2a) Thanks [@lisachandra](https://github.com/lisachandra)! - Simplify agent logs back to one live file, plus a dirac-only digest.

  - `.log` files are plain upstream file-mode logs again (`FileDisplay` output
    with `verbose: true`, matching pre-split behavior). The split-file
    machinery (`splitFileLogging`, `postProcessAgentLog`, `.raw.log`,
    `.readable.log`) is removed; leftover `.raw.log` / `.readable.log` files
    from earlier runs can be deleted.
  - Dirac runs additionally stream a clean markdown digest
    (`issue-<n>.dirac.log`, same rendering as the old `.readable.log`) live as
    agent events arrive, so the readable output exists from run start and
    survives failures — no more waiting for an end-of-run post-process step.

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Modularize the agent-provider bundle and unify issue-metadata fetching.

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

## 0.5.0

### Minor Changes

- Run the same worktree preparation used by issue runs (`.env` copy, `setupCommands`, and
  `symlinks`) before integration merge/resume agents start. `--ignore-setup` and `--skip-setup`
  now apply to `merge`, `merge-integrations`, and `integration-resume` as well.

## 0.4.0

### Minor Changes

- Add `--skip-setup` to skip the configured setup commands for issue, issue-all, and
  issue-sequence runs while still linking configured symlinks.

### Patch Changes

- `--ignore-setup` now links configured symlinks even when the setup command fails, instead of
  skipping the remainder of the setup step.

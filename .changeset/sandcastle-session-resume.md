---
"@lisachandra/sandcastle": minor
---

Resume agent sessions across phase retries for dirac and zcode

A phase that died mid-run used to restart the agent from scratch on every
retry: the retry loop re-invoked the provider with no memory of the session it
had just lost, so all conversation context (explored files, decisions, partial
work) was gone exactly when the provider was flakiest (closes #39).

- Both resumable backends now announce their session id on the stream (dirac's
  `task_started` JSON line, the zcode wrapper's `session_id` event), and
  sandcastle persists the last captured id per phase scope under
  `<.sandcastle>/sessions/`. The id is recorded even when the run fails — the
  failure case is exactly when resume matters.
- The next attempt of the same phase offers the stored id back: upstream
  prechecks it via the provider's new `sessionStorage` and forwards it into the
  command (dirac `-T <taskId>`, zcode `--resume-session <id>` → the app-server's
  `session/resume`). A resumed run keeps the full conversation history and the
  wrapper still streams `desktop-continuous` events unchanged.
- A session id the backend rejects as stale (pruned store, wrong worktree) is
  cleared so the following retry starts fresh instead of failing the same way
  forever.
- Set `SANDCASTLE_NO_SESSION_RESUME=1` to disable resume entirely (fresh
  sessions on every attempt); unset it to restore the default behavior.
- Other backends (pi, codex, claude-code, cursor, copilot, opencode) keep their
  current fresh-session behavior; wiring their upstream session storage is a
  follow-up.

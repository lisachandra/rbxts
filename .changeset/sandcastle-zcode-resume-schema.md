---
"@lisachandra/sandcastle": patch
---

Fix zcode session/resume rejection that looped the review phase forever

The zcode wrapper forwarded a root `model` key in its `session/resume` params,
but the real app-server's resume schema rejects that key ("Invalid params —
(root): Unrecognized key: \"model\"") — `session/create` accepts it, so only
resumed attempts failed. When a phase failed after capturing a session (game
repo issue #398's review phase), every retry then resumed the stored session,
hit the rejection within ~2s, and repeated forever: the error matched neither
the fatal-error patterns nor the stale-session patterns, so the store never
dropped the id, and the retry log printed only the error's first line
("zcode exited with code 1:"), hiding the cause.

- The wrapper's resume path no longer sends `model`. The resumed session's model
  is re-asserted afterwards through `session/setModel`, because the app-server's
  resume path restores the persisted selection and ignores the request's
  `thoughtLevel` — so the resumed run still ends up on the requested model and
  effort (the `thoughtLevel` key is no longer forwarded, since it had no
  effect).
- The stub app-server mirrors the real resume schema (rejects `model`), and
  the wrapper test asserts the resume params carry no model.
- A resume rejected as "invalid params" / "unrecognized key" now counts as a
  stale session: the store is cleared so the next attempt starts fresh.
- Failing wrapper paths flush stderr before exiting (pipe writes are async;
  `process.exit` could drop the only copy of the real error) — this is what
  made the console error look empty.
- The retry warning keeps up to four lines of the error instead of only the
  first, so "zcode exited with code 1:" is followed by the actual cause.

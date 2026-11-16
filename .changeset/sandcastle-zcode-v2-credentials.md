---
"@lisachandra/sandcastle": patch
---

Read the zcode 3.18 credential-store format so plan-mode lanes authenticate

zcode 3.18 migrated `~/.zcode/v2/credentials.json` to `enc:v2:<os|env>:<fingerprint>:`
records under a random 32-byte key held in the OS keyring (or a managed secret for
headless servers). The wrapper only understood `enc:v1:`, so it handed the _ciphertext_
to the plan gateway as the api key; the gateway answered 401 with an empty body and
every `account:zai-start-plan` lane died on its first model attempt.

- Both schemes are read (the keyring binding is loaded from the installed desktop app's
  `app.asar.unpacked`, exactly where the CLI keeps it), and a v2 record's embedded
  fingerprint is cross-checked before decrypting, the way the CLI does.
- A record that cannot be opened is now _skipped_, never offered as a credential: the
  header answer is `headersApplied: false` with an actionable message, so a turn fails
  loudly instead of sending ciphertext to the gateway. Diagnostics name credential
  _keys_ only, never values.
- The runtime-header handler is async so the store can be resolved on demand; a handler
  rejection is still answered, so a turn cannot hang waiting on it.
- The stub app-server gained an opt-in runtime-header probe (`STUB_REQUEST_RUNTIME_HEADERS`),
  and `src/providers/zcode-credentials.test.ts` pins the invariant end to end: decrypted
  plaintext is offered, v1 keeps working, undecryptable/absent stores are refused, and
  ciphertext never appears in a header answer.

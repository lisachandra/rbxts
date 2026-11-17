---
"@lisachandra/platform": major
---

fix(teleporter)!: require a secret, bound the clock skew, and MAC the whole payload

An unconfigured teleporter used to verify tokens with `sha256(stamp)`, which anyone can compute — any
player could join with `{ hash = sha256(tostring(t)), stamp = t }` and be treated as a legitimate
teleport. Four defects are fixed together because they are one decision about what a token is:

- **A secret is required.** `isValidTeleport` halts, naming `configureTeleportSecret`, when none has
  been configured. Previously it silently verified against an empty secret.
- **A blank secret is refused at the call site.** `configureTeleportSecret("")` and `"   "` now halt
  where they are called rather than deferring the same failure to the first teleport.
- **The expiry window is two-sided.** A `stamp` more than 60 seconds in the future is rejected even
  with a correct signature; `now < stamp + expiration` alone accepted `stamp = now + 10^9` for around
  31 years. The 60 seconds is the allowance for clock drift between servers.
- **The MAC covers the payload.** `hash` was `sha256(stamp + secret)`, so every other field rode along
  unauthenticated while `success` stayed `true`. It now covers a canonical rendering of the whole
  payload, so a changed field invalidates the token.

## Migration

This is a **wire-format break** with no dual-verify path: a token minted before this change fails
verification after it, so a teleport in flight across the deploy fails and the player is not admitted.

1. Call `configureTeleportSecret(secret)` in **every** participating place, before the first
   `serializeTeleportData` or `isValidTeleport`. A place that never configured a secret used to work
   by accident and now halts.
2. Use the same secret everywhere. A mismatch presents as every teleport being invalid.
3. Keep the secret out of source — read it from configuration. Anyone holding it can mint valid tokens.

`serializeTeleportData` now takes `TeleportPayload` (`Record<string, defined>`) instead of
`Omit<PossibleTeleportData, "hash" | "stamp">`, which was the empty object type: payload fields were
not expressible before.

The verification itself is now `verifyTeleportData(data, now)`, a pure function, with
`isValidTeleport(player)` the wrapper that reads the player's join data. `signTeleportData(payload,
stamp)` mints a token without a `TeleportOptions` instance. Both exist because the offline test lane's
emulator cannot round-trip `TeleportOptions` — `GetTeleportData` returns `nil` there — so anything
reachable only through the wrapper would be untestable.

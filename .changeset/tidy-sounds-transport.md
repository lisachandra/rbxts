---
"@lisachandra/matter": minor
---

Refactor the `utils/sound` playback interface to accept a whole authored `Sound` profile **or** per-key overrides — `AudioPlayback` is now `Sound | PlaybackOverrides` instead of a fixed three-field struct.

- `PlaybackOverrides` is a partial over the `AudioPlayer`'s writable properties (minus identity/lifecycle keys), so a caller passes only what actually varies per spawn — and gets `LoopRegion`/`PlaybackRegion`/`TimePosition`/etc. for free instead of `{ looping, playbackSpeed, volume }`.
- Passing a `Sound` as playback is **wholesale replacement** — `applyPlayback` copies the whole authored profile (`SoundId → Asset`, `Looped → Looping`, `LoopRegion`, `PlaybackRegion`, `PlaybackSpeed`, `Volume`) onto the player, ignoring `Pitch` (the player has no separate pitch surface).
- `applySoundProfile` (the `SOUND_PROFILE_MAP` adapter) is now internal to the module, not exported.
- `applyPlayback` iterates the writable surface instead of assigning per-field, so future `AudioPlayer` properties need a type-level change only.
- `placeAudioToModelWithPlayback` and `placeAudioAtPosition` apply the authored profile (both regions included) and then the optional playback config, instead of copying only `LoopRegion` by hand.

**Breaking:** callers of `applyPlayback`/`placeAudioToModelWithPlayback`/`placeAudioAtPosition`/`spawnAudioNode` that pass an override must switch from `{ looping, playbackSpeed, volume }` to the `AudioPlayer`-surface shape (`{ Looping, PlaybackSpeed, Volume }`), or pass a whole `Sound` instance.

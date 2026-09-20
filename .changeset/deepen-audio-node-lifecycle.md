---
"@lisachandra/matter": minor
---

Deepen the audio-node lifecycle behind a single emitter module: `@lisachandra/matter/utils/audioEmitter`.

- New `emitAudioNode(options)` owns cache-part acquisition (or reuse of a provided node), positioning on a `Model` pivot or `Vector3`, and the two-layer playback transport (authored `Sound` profile + `AudioPlayback` overrides).
- New `recycleAudioNode(node)` re-parents the node to `Workspace.Caches.Sound`, returns it to `soundEmitterCache`, and records diagnostics via `recordNodeReturned()`.
- New `getNodeFromEmitter(emitter)` resolves the containing node `Part` via an ancestor walk and validates its audio attachment, replacing fragile `emitter.Parent!.Parent!` guessing in the client sound manager.
- New `assembleSoundComponent(node, soundId)` is the single authoritative construction of the `Sound` component payload (`effects`, `emitter`, `id`, `players`), eliminating the previously duplicated creation logic across spawn sites and systems.
- `utils/sound` public APIs (`spawnAudioNode`, `placeModelAudioInWorld`, `placeAudioToModelWithPlayback`, `placeAudioAtPosition`, `connectAudio`, `rearrangeAudio`) remain backward-compatible thin wrappers delegating to the emitter module.
- The `Sound`/`Node` ECS component shapes and network wire format are unchanged.

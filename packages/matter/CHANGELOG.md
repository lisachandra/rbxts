# @lisachandra/matter

## 1.0.0

### Major Changes

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Replace `@rbxts/lapis` persistence with the `@rbxts/dataforge` store.

  - `@lisachandra/core` now types server documents as `dataforge.Profile<CollectionData>`. The crate
    `documents` middleware performs immutable updates via `profile.update()` instead of `document.write()`.
    `waitForDocument`/`configureDocumentAccessor` return `Profile<CollectionData>`.
  - `@lisachandra/matter` `DocumentConfig.collection` is replaced by `store: dataforge.Store<CollectionData>`
    (the old `collection` key is deprecated but still accepted). `useDocument` loads via
    `store.load(\`Player_${userId}\`, [userId])`, caches profiles in `store.documents`, binds
`profile.on_closed`cleanup, and unloads via`profile.unload()`.
  - `@lisachandra/platform` drops the `@rbxts/lapis-mockdatastore` test config in favor of a
    `createTestStore()` helper backed by the dataforge memory hook and virtual scheduler. The centurion
    `document` command now reads via `document.get_data()` and unloads via `document.unload()`.

  Consumers must install `@rbxts/dataforge` (^0.1.0) and replace any `@rbxts/lapis` collections with a
  dataforge store created via `dataforge.create_store()`. Live-game data migrations are handled by the
  game repo, not this package.

### Minor Changes

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Deepen the audio-node lifecycle behind a single emitter module: `@lisachandra/matter/utils/audioEmitter`.

  - New `emitAudioNode(options)` owns cache-part acquisition (or reuse of a provided node), positioning on a `Model` pivot or `Vector3`, and the two-layer playback transport (authored `Sound` profile + `AudioPlayback` overrides).
  - New `recycleAudioNode(node)` re-parents the node to `Workspace.Caches.Sound`, returns it to `soundEmitterCache`, and records diagnostics via `recordNodeReturned()`.
  - New `getNodeFromEmitter(emitter)` resolves the containing node `Part` via an ancestor walk and validates its audio attachment, replacing fragile `emitter.Parent!.Parent!` guessing in the client sound manager.
  - New `assembleSoundComponent(node, soundId)` is the single authoritative construction of the `Sound` component payload (`effects`, `emitter`, `id`, `players`), eliminating the previously duplicated creation logic across spawn sites and systems.
  - `utils/sound` public APIs (`spawnAudioNode`, `placeModelAudioInWorld`, `placeAudioToModelWithPlayback`, `placeAudioAtPosition`, `connectAudio`, `rearrangeAudio`) remain backward-compatible thin wrappers delegating to the emitter module.
  - The `Sound`/`Node` ECS component shapes and network wire format are unchanged.

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Introduce `@lisachandra/matter/utils/itemPointer` to centralize item pointer encoding (`encodeItemPointer`), parsing (`parseItemPointer`), and field accessors (`itemLocation`, `itemEntityId`). Migrate all raw `split("_")` parsing in `utils/item.ts`, server `itemManager`, and client `itemManager` to the new module.

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Narrow item utilities behind lookup and state seams:

  - Add `@lisachandra/matter/utils/item/lookup` with 17 pure lookup helpers
  - Add `@lisachandra/matter/utils/item/state` with 9 world-dependent helpers taking `world: World` as first parameter
  - Deprecate barrel exports in `@lisachandra/matter/utils/item` while keeping full backward compatibility

- [`7602c35`](https://github.com/lisachandra/rbxts/commit/7602c35979ac1d4d78391f49053bc48365119edb) Thanks [@lisachandra](https://github.com/lisachandra)! - Refactor the `utils/sound` playback interface to accept a whole authored `Sound` profile **or** per-key overrides — `AudioPlayback` is now `Sound | PlaybackOverrides` instead of a fixed three-field struct.

  - `PlaybackOverrides` is a partial over the `AudioPlayer`'s writable properties (minus identity/lifecycle keys), so a caller passes only what actually varies per spawn — and gets `LoopRegion`/`PlaybackRegion`/`TimePosition`/etc. for free instead of `{ looping, playbackSpeed, volume }`.
  - Passing a `Sound` as playback is **wholesale replacement** — `applyPlayback` copies the whole authored profile (`SoundId → Asset`, `Looped → Looping`, `LoopRegion`, `PlaybackRegion`, `PlaybackSpeed`, `Volume`) onto the player, ignoring `Pitch` (the player has no separate pitch surface).
  - `applySoundProfile` (the `SOUND_PROFILE_MAP` adapter) is now internal to the module, not exported.
  - `applyPlayback` iterates the writable surface instead of assigning per-field, so future `AudioPlayer` properties need a type-level change only.
  - `placeAudioToModelWithPlayback` and `placeAudioAtPosition` apply the authored profile (both regions included) and then the optional playback config, instead of copying only `LoopRegion` by hand.

  **Breaking:** callers of `applyPlayback`/`placeAudioToModelWithPlayback`/`placeAudioAtPosition`/`spawnAudioNode` that pass an override must switch from `{ looping, playbackSpeed, volume }` to the `AudioPlayer`-surface shape (`{ Looping, PlaybackSpeed, Volume }`), or pass a whole `Sound` instance.

### Patch Changes

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Consolidate Inventory, Hotbar, and Items replication codecs behind one `network/builtins/itemList` factory (`createItemListSerializer`, `createItemListDeserializer`, `createItemListCodecRegistration`).

  - Fixes Hotbar cross-entity delta pollution by tracking `lastReplicatedItems` per entity ID.
  - Wire format (`ItemData`, `InventoryPayload`, `HotbarPayload`, `ItemsPayload`) and replication modes (`owner`/`owner`/`all`) are unchanged.

- [#22](https://github.com/lisachandra/rbxts/pull/22) [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492) Thanks [@lisachandra](https://github.com/lisachandra)! - Give replication codecs a state seam for testability: a `CodecStateReader` interface with a production store-backed adapter (`defaultStateReader`) and an `InMemoryCodecStateReader` for unit tests.

  - `network/builtins/item.ts` (`itemsSerializer`, `itemsDeserializer`), `network/builtins/itemList.ts` (`createItemListSerializer`, `createItemListDeserializer`, `createItemListCodecRegistration`), and `network/builtins/stream.ts` (`createStreamDeserializer`) accept an optional reader and default to the production adapter.
  - `inventory.ts`, `hotbar.ts`, `items.ts`, `item.ts`, `itemList.ts`, and `stream.ts` no longer import `@lisachandra/core/store` directly.
  - Wire format (`ItemData`, payload schemas) and replication modes (`owner`/`all`) are unchanged.

- Updated dependencies [[`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492), [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492)]:
  - @lisachandra/core@1.0.0

## 0.1.2

### Patch Changes

- [`e5aeaa7`](https://github.com/lisachandra/rbxts/commit/e5aeaa7c9ffb211a09cf09ef87b9bf30b7c409c1) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix client crash when a component removal packet arrives for an entity the client has never spawned.

  The client replication manager no longer deserializes nil payloads (which crashed
  `component.patch(nil)` inside `immutable.merge`), and the server skips sending component
  removals for entities that were never replicated to the target client.

- Updated dependencies [[`d3bc2dd`](https://github.com/lisachandra/rbxts/commit/d3bc2dd5258c3f7ff2781d305e34e951d9c91fe2)]:
  - @lisachandra/types@0.1.2
  - @lisachandra/core@0.1.1

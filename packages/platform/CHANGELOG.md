# @lisachandra/platform

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

### Patch Changes

- Updated dependencies [[`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492), [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492), [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492), [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492), [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492), [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492), [`199d306`](https://github.com/lisachandra/rbxts/commit/199d30653dab520eff1968ec7f54994c95233492), [`7602c35`](https://github.com/lisachandra/rbxts/commit/7602c35979ac1d4d78391f49053bc48365119edb)]:
  - @lisachandra/matter@1.0.0
  - @lisachandra/core@1.0.0

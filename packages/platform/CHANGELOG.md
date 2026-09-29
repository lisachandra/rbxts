# @lisachandra/platform

## 1.0.1

### Patch Changes

- [`94effd9`](https://github.com/lisachandra/rbxts/commit/94effd98e6dad8dd7c24db1d8cbad28b9afa9d92) Thanks [@lisachandra](https://github.com/lisachandra)! - Migrated all `print`/`warn`/`error` callsites to structured logging via `@rbxts/log` (`Log.Info`/`Log.Warn`). Corrected non-halting `Log.Error` usages that were expected to terminate control flow to `Log.Fatal` (the throwing level), and removed unnecessary `pcall` wrapping in the logger sink now that `LogService.Log` with `MessageError` no longer needs defensive error handling.

- Updated dependencies [[`a4e8bd7`](https://github.com/lisachandra/rbxts/commit/a4e8bd7ef903286ccff155d8481a15f1c84ab087), [`94effd9`](https://github.com/lisachandra/rbxts/commit/94effd98e6dad8dd7c24db1d8cbad28b9afa9d92)]:
  - @lisachandra/core@1.0.1
  - @lisachandra/matter@1.0.1

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

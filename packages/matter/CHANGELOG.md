# @lisachandra/matter

## 0.1.2

### Patch Changes

- [`e5aeaa7`](https://github.com/lisachandra/rbxts/commit/e5aeaa7c9ffb211a09cf09ef87b9bf30b7c409c1) Thanks [@lisachandra](https://github.com/lisachandra)! - Fix client crash when a component removal packet arrives for an entity the client has never spawned.

  The client replication manager no longer deserializes nil payloads (which crashed
  `component.patch(nil)` inside `immutable.merge`), and the server skips sending component
  removals for entities that were never replicated to the target client.

- Updated dependencies [[`d3bc2dd`](https://github.com/lisachandra/rbxts/commit/d3bc2dd5258c3f7ff2781d305e34e951d9c91fe2)]:
  - @lisachandra/types@0.1.2
  - @lisachandra/core@0.1.1
